import os
import requests
from flask import Flask, render_template, request, jsonify, g, session, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from authlib.integrations.flask_client import OAuth

app = Flask(__name__)

# --- Configuration for Render with PostgreSQL ---
# This line is corrected to properly handle the connection string from Neon/Render
db_url = os.environ.get('DATABASE_URL')
if db_url and db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

app.config['SQLALCHEMY_DATABASE_URI'] = db_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.secret_key = os.environ.get('SECRET_KEY')
app.config['GOOGLE_CLIENT_ID'] = os.environ.get('GOOGLE_CLIENT_ID')
app.config['GOOGLE_CLIENT_SECRET'] = os.environ.get('GOOGLE_CLIENT_SECRET')
API_KEY = os.environ.get('API_KEY')

db = SQLAlchemy(app)
oauth = OAuth(app)
google = oauth.register(
    name='google',
    client_id=app.config.get("GOOGLE_CLIENT_ID"),
    client_secret=app.config.get("GOOGLE_CLIENT_SECRET"),
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid email profile'}
)

API_URL = "https://openrouter.ai/api/v1/chat/completions"

# --- SQLAlchemy Database Models ---
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    conversations = db.relationship('Conversation', backref='user', lazy=True, cascade="all, delete-orphan")

class Conversation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title = db.Column(db.String(120), nullable=False)
    messages = db.relationship('Message', backref='conversation', lazy=True, cascade="all, delete-orphan")

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    conversation_id = db.Column(db.Integer, db.ForeignKey('conversation.id'), nullable=False)
    role = db.Column(db.String(10), nullable=False) # 'user' or 'assistant'
    content = db.Column(db.Text, nullable=False)


# --- Authentication Routes ---
@app.route("/signup", methods=["POST"])
def signup():
    data = request.json
    username, email, password = data.get("username"), data.get("email"), data.get("password")
    if not all([username, email, password]): return jsonify({"success": False, "message": "All fields are required."}), 400
    if User.query.filter((User.username == username) | (User.email == email)).first(): return jsonify({"success": False, "message": "Username or email already exists."}), 409
    
    new_user = User(username=username, email=email, password_hash=generate_password_hash(password))
    db.session.add(new_user)
    db.session.commit()

    session.clear()
    session['user_id'], session['username'] = new_user.id, new_user.username
    return jsonify({"success": True, "message": "Account created and logged in!"})

@app.route("/login", methods=["POST"])
def login():
    data = request.json
    email, password = data.get("email"), data.get("password")
    if not all([email, password]): return jsonify({"success": False, "message": "Email and password are required."}), 400
    
    user = User.query.filter_by(email=email).first()
    if user and user.password_hash != 'oauth_google_user' and check_password_hash(user.password_hash, password):
        session.clear()
        session['user_id'], session['username'] = user.id, user.username
        return jsonify({"success": True, "message": "Logged in successfully."})
    
    return jsonify({"success": False, "message": "Invalid email or password."}), 401

@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"success": True, "message": "You have been logged out."})

@app.route("/check_session", methods=["GET"])
def check_session():
    if 'user_id' in session:
        return jsonify({"logged_in": True, "username": session['username']})
    return jsonify({"logged_in": False})


# --- Google Login Routes ---
@app.route('/google-login')
def google_login():
    redirect_uri = url_for('google_callback', _external=True)
    return google.authorize_redirect(redirect_uri)

@app.route('/google-callback')
def google_callback():
    try:
        token = google.authorize_access_token()
        user_info = oauth.google.userinfo()
        email, username = user_info['email'], user_info.get('name', email.split('@')[0])
        
        user = User.query.filter_by(email=email).first()
        if not user:
            user = User(username=username, email=email, password_hash='oauth_google_user')
            db.session.add(user)
            db.session.commit()
            
        session.clear()
        session['user_id'], session['username'] = user.id, user.username
        return redirect(url_for('index'))
    except Exception as e:
        return f"An error occurred: {e}", 500


# --- Application Routes ---
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/get_conversations", methods=["GET"])
def get_conversations():
    if 'user_id' not in session: return jsonify([]), 401
    user = User.query.get(session['user_id'])
    return jsonify([{"id": c.id, "title": c.title} for c in user.conversations])

@app.route("/get_messages/<int:conv_id>", methods=["GET"])
def get_messages(conv_id):
    if 'user_id' not in session: return jsonify({"error": "Not authorized"}), 401
    conv = Conversation.query.filter_by(id=conv_id, user_id=session['user_id']).first()
    if not conv: return jsonify({"error": "Conversation not found"}), 404
    return jsonify([{"role": m.role, "content": m.content} for m in conv.messages])

@app.route("/chat", methods=["POST"])
def chat():
    if 'user_id' not in session: return jsonify({"reply": "Please log in to start a chat.", "error": True}), 401
    
    data = request.json
    user_message, conv_id = data.get("message"), data.get("conversation_id")

    if not conv_id:
        title = ' '.join(user_message.split()[:5])
        if len(user_message.split()) > 5: title += '...'
        new_conv = Conversation(user_id=session['user_id'], title=title)
        db.session.add(new_conv)
        db.session.commit()
        conv_id = new_conv.id
    
    user_msg = Message(conversation_id=conv_id, role='user', content=user_message)
    db.session.add(user_msg)
    
    history = Message.query.filter_by(conversation_id=conv_id).all()
    history_formatted = [{"role": m.role, "content": m.content} for m in history]
    
    bot_reply = get_bot_response(history_formatted)
    bot_msg = Message(conversation_id=conv_id, role='assistant', content=bot_reply)
    db.session.add(bot_msg)
    
    db.session.commit()
    
    return jsonify({"reply": bot_reply, "conversation_id": conv_id})

def get_bot_response(history):
    system_message = "You are a helpful AI assistant in a dark-themed chat."
    payload = {"model": "openai/gpt-4o-mini", "messages": [{"role": "system", "content": system_message}] + history}
    headers = {"Authorization": f"Bearer {API_KEY}"}
    try:
        response = requests.post(API_URL, json=payload, headers=headers, timeout=30)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"API Error: {e}")
        return "Sorry, I couldn't connect to the AI service."