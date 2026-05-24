import os
import sys
from sqlalchemy import text
from sqlalchemy.orm import Session

# Add root to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.api.database import SessionLocal, Base
from src.api import models

def sync_schema():
    db = SessionLocal()
    try:
        print("Syncing schema...")
        
        # 1. Create groups table if not exists (using SQLAlchemy to avoid FK issues)
        # We need to drop if it was partially created
        db.execute(text("DROP TABLE IF EXISTS groups"))
        db.commit()
        
        # Import models ensures they are in metadata
        Base.metadata.create_all(db.get_bind(), tables=[models.Group.__table__])
        print("Table 'groups' created successfully.")
        
        # 2. Add group_id to meetings if not exists
        try:
            db.execute(text("ALTER TABLE meetings ADD COLUMN group_id VARCHAR(36) AFTER organization_id"))
            db.execute(text("ALTER TABLE meetings ADD CONSTRAINT fk_meeting_group FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL"))
            print("Added group_id column to meetings.")
        except Exception as e:
            print(f"group_id column already exists or error: {e}")
            
        db.commit()
        print("Schema sync completed.")
    except Exception as e:
        print(f"Error syncing schema: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    sync_schema()
