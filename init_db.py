from app import app, db

# This script will create all the database tables based on your models
with app.app_context():
    print("Creating database tables...")
    db.create_all()
    print("Database tables created successfully.")