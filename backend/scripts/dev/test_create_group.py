import os
import uuid
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

db_url = os.getenv("DATABASE_URL")
engine = create_engine(db_url)
SessionLocal = sessionmaker(bind=engine)
db = SessionLocal()

# Mock data
group_data = {
    "organization_id": "d64bbcca-59c2-4624-a201-32403054a5c7",
    "name": "Test Group from Script",
    "description": "Testing persistence",
    "privacy_level": "private"
}
created_by = "5e475a16-ef5b-4e44-8d25-a71facf69bb1"

try:
    from src.api.models import Group
    db_group = Group(
        id=str(uuid.uuid4()),
        organization_id=group_data["organization_id"],
        name=group_data["name"],
        description=group_data.get("description"),
        privacy_level=group_data.get("privacy_level", "private"),
        created_by=created_by
    )
    db.add(db_group)
    db.commit()
    print("Group committed successfully")
    
    # Verify
    count = db.execute(text("SELECT count(*) FROM groups")).scalar()
    print(f"Groups count after commit: {count}")
    
except Exception as e:
    print(f"Error: {e}")
    db.rollback()
finally:
    db.close()
