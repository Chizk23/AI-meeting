import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

db_url = os.getenv("DATABASE_URL")
engine = create_engine(db_url)

with engine.connect() as conn:
    # Check groups
    result = conn.execute(text("SELECT * FROM groups"))
    groups = result.fetchall()
    print(f"Groups in DB: {len(groups)}")
    for g in groups:
        print(g)

    # Check meetings
    result = conn.execute(text("SELECT * FROM meetings"))
    meetings = result.fetchall()
    print(f"Meetings in DB: {len(meetings)}")
    for m in meetings:
        print(m)

    # Check organizations
    result = conn.execute(text("SELECT * FROM organizations"))
    orgs = result.fetchall()
    print(f"Organizations in DB: {len(orgs)}")
    for o in orgs:
        print(o)
