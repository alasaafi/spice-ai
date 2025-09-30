import sqlite3
import requests
import os
from flask import Flask, render_template, request, jsonify, g, session, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
from authlib.integrations.flask_client import OAuth

app = Flask(__name__)

# --- Configuration for Render ---
# The database will live on a persistent disk mounted at /var/data
DISK_PATH = '/var/data'
DB_PATH = os.path.join(DISK_PATH, 'database.db')

# Secrets and configurations are read from Render's Environment Variables
app.config['DATABASE'] = DB_PATH
app.secret_key = os.environ.get('SECRET_KEY')
app.config['GOOGLE_CLIENT_ID'] = os.environ.get('GOOGLE_CLIENT_ID')
app.config['GOOGLE_CLIENT_SECRET'] = os.environ.get('GOOGLE_CLIENT_SECRET')
API_KEY = os.environ.get('API_KEY')

oauth = OAuth(app)
google = oauth.register(
    name='google',
    client_id=app.config.get("GOOGLE_CLIENT_ID"),
    client_secret=app.config.get("GOOGLE_CLIENT_SECRET"),
    server_metadata_url='https.accounts.google.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid email profile'}
)

API_URL = "https://openrouter.ai/api/v1/chat/completions"

# --- Database Management ---
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        # Create the directory for the disk if it doesn't exist
        os.makedirs(DISK_PATH, exist_ok=True)
        
        db_path = app.config['DATABASE']
        # If the DB file doesn't exist on the disk, initialize it
        if not os.path.exists(db_path):
            print(f"Database not found at {db_path}, initializing...")
            # schema.sql is in the root directory of the project
            schema_path = os.path.join(app.root_path, '..', 'schema.sql')
            temp_db = sqlite3.connect(db_path)
            with open(schema_path, 'r') as f:
                temp_db.executescript(f.read())
            temp_db.close()
            print("Database initialized.")

        db = g._database = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()

# --- Authentication Routes ---

@app.route("/signup", methods=["POST"])
def signup():
    data = request.json
    username = data.get("username")
    email = data.get("email")
    password = data.get("password")

    if not all([username, email, password]):
        return jsonify({"success": False, "message": "All fields are required."}), 400

    db = get_db()
    if db.execute('SELECT id FROM users WHERE username = ? OR email = ?', (username, email)).fetchone():
        return jsonify({"success": False, "message": "Username or email already exists."}), 409

    password_hash = generate_password_hash(password)
    
    cursor = db.execute(
        'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
        (username, email, password_hash)
    )
    db.commit()

    new_user_id = cursor.lastrowid
    session.clear()
    session['user_id'] = new_user_id
    session['username'] = username
    
    return jsonify({"success": True, "message": "Account created and logged in successfully!"})

@app.route("/login", methods=["POST"])
def login():
    data = request.json
    email = data.get("email")
    password = data.get("password")

    if not all([email, password]):
        return jsonify({"success": False, "message": "Email and password are required."}), 400

    db = get_db()
    user = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()

    if user and user['password_hash'] != 'oauth_google_user' and check_password_hash(user['password_hash'], password):
        session.clear()
        session['user_id'] = user['id']
        session['username'] = user['username']
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
        
        email = user_info['email']
        username = user_info.get('name', email.split('@')[0])

        db = get_db()
        user = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()

        if not user:
            db.execute(
                'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
                (username, email, 'oauth_google_user')
            )
            db.commit()
            user = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()

        session.clear()
        session['user_id'] = user['id']
        session['username'] = user['username']
        
        return redirect(url_for('index'))
    except Exception as e:
        print(f"An error occurred in google_callback: {e}")
        return "An error occurred during Google login. Please try again.", 500

# --- Application Routes ---

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/get_conversations", methods=["GET"])
def get_conversations():
    if 'user_id' not in session:
        return jsonify([]), 401
    db = get_db()
    conversations = db.execute(
        'SELECT id, title FROM conversations WHERE user_id = ? ORDER BY created_at DESC',
        (session['user_id'],)
    ).fetchall()
    return jsonify([dict(conv) for conv in conversations])

@app.route("/get_messages/<int:conv_id>", methods=["GET"])
def get_messages(conv_id):
    if 'user_id' not in session: return jsonify({"error": "Not authorized"}), 401
    db = get_db()
    conv = db.execute('SELECT id FROM conversations WHERE id = ? AND user_id = ?', (conv_id, session['user_id'])).fetchone()
    if not conv: return jsonify({"error": "Conversation not found or access denied"}), 404
    messages = db.execute('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id ASC', (conv_id,)).fetchall()
    return jsonify([dict(msg) for msg in messages])

@app.route("/chat", methods=["POST"])
def chat():
    if 'user_id' not in session: return jsonify({"reply": "Please log in to start a chat.", "error": True}), 401
    data = request.json
    user_message = data.get("message")
    conv_id = data.get("conversation_id")
    db = get_db()
    if not conv_id:
        title = ' '.join(user_message.split()[:5])
        if len(user_message.split()) > 5: title += '...'
        cursor = db.execute('INSERT INTO conversations (user_id, title) VALUES (?, ?)', (session['user_id'], title))
        conv_id = cursor.lastrowid
        db.commit()
    db.execute('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)', (conv_id, 'user', user_message))
    db.commit()
    history_rows = db.execute('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id ASC', (conv_id,)).fetchall()
    history = [dict(row) for row in history_rows]
    bot_reply = get_bot_response(history)
    db.execute('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)', (conv_id, 'assistant', bot_reply))
    db.commit()
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
    except requests.exceptions.RequestException as e:
        return f"Error: API connection failed. {e}"
    except (KeyError, IndexError):
        return "Error: Invalid response from API."

# NOTE: The if __name__ == "__main__" block is not needed for deployment on Render,
# as it uses Gunicorn to run the 'app' object directly.