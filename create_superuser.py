"""
Script to create the initial superuser account for Open Notebook multi-user mode.

Usage:
    python create_superuser.py

This script creates a superuser account with the following credentials:
    Email: david@itak.live
    Password: Wildcats@4113
    Role: superuser

Run this script after starting Open Notebook in multi-user mode for the first time.
"""

import asyncio
import sys
import os

# Add the project root to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from open_notebook.domain.user import User
from api.auth import hash_password


async def create_superuser():
    """Create the initial superuser account."""
    username = "david"
    email = "david@itak.live"
    password = "Wildcats@4113"
    display_name = "David"
    role = "superuser"
    
    print(f"Creating superuser account...")
    print(f"  Username: {username}")
    print(f"  Email: {email}")
    print(f"  Role: {role}")
    
    # Check if user already exists
    existing_user = await User.get_by_username(username)
    if existing_user:
        print(f"  User '{username}' already exists with role: {existing_user.role}")
        
        # Update to superuser if not already
        if existing_user.role != "superuser":
            existing_user.role = "superuser"
            existing_user.email = email
            await existing_user.save()
            print(f"  Updated user to superuser role")
        else:
            print(f"  User is already a superuser")
        return existing_user
    
    # Create new user
    user = User(
        username=username,
        email=email,
        password_hash=hash_password(password),
        display_name=display_name,
        role=role,
        is_active=True,
    )
    await user.save()
    
    print(f"  Superuser created successfully!")
    print(f"  User ID: {user.id}")
    return user


async def main():
    """Main entry point."""
    try:
        user = await create_superuser()
        print("\nSuperuser account ready!")
        print(f"Login with username: {user.username}")
        print("Password: [hidden for security]")
    except Exception as e:
        print(f"Error creating superuser: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
