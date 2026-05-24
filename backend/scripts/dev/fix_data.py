import os
import sys
from sqlalchemy import text
from sqlalchemy.orm import Session

# Add root to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.api.database import SessionLocal
import uuid

def fix_data():
    db = SessionLocal()
    try:
        # Get the user
        user = db.execute(text("SELECT id FROM users WHERE username = 'Oanh'")).fetchone()
        # Get the organization
        org = db.execute(text("SELECT id FROM organizations WHERE name LIKE '%OH%'")).fetchone()
        
        if user and org:
            print(f"Linking user {user.id} to org {org.id}")
            # Insert membership
            db.execute(text("INSERT INTO user_organizations (id, user_id, organization_id, role, joined_at) VALUES (:id, :u, :o, 'org-admin', NOW())"), 
                       {"id": str(uuid.uuid4()), "u": user.id, "o": org.id})
            db.commit()
            print("Success!")
        else:
            print("Could not find user or org")
    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    fix_data()
