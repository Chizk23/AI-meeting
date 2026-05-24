import os
import sys
from sqlalchemy import text
from sqlalchemy.orm import Session

# Add root to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.api.database import SessionLocal

def migrate_db():
    db = SessionLocal()
    try:
        print("Starting database migration...")
        
        # 1. Add organization_id column to meetings
        db.execute(text("ALTER TABLE meetings ADD COLUMN organization_id VARCHAR(36) AFTER id"))
        print("Added organization_id column.")
        
        # 2. Add foreign key constraint
        db.execute(text("ALTER TABLE meetings ADD CONSTRAINT fk_meeting_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"))
        print("Added foreign key constraint fk_meeting_org.")
        
        # 3. Add index for performance
        db.execute(text("CREATE INDEX idx_meetings_org_id ON meetings(organization_id)"))
        print("Created index for organization_id.")
        
        db.commit()
        print("Migration completed successfully!")
    except Exception as e:
        print(f"Migration error: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    migrate_db()
