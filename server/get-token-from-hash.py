#!/usr/bin/env python3
"""
Get the plain token from a token hash
This is a helper script - normally you'd get the token from generate-invite.js output
"""

import json
import sys
import hashlib
import secrets

# Read the invite tokens file
try:
    with open('data/invite-tokens.json', 'r') as f:
        invite_tokens = json.load(f)
except FileNotFoundError:
    print("Error: data/invite-tokens.json not found")
    sys.exit(1)

# Find the active token
active_token = None
for token_id, token_data in invite_tokens.items():
    if token_data.get('usedAt') is None and token_data.get('expiresAt', 0) > (__import__('time').time() * 1000):
        active_token = token_data
        break

if not active_token:
    print("No active invite token found. Generating a new one...")
    
    # Read users to find owner
    with open('data/users.json', 'r') as f:
        users = json.load(f)
    
    owner_user = None
    for user_id, user_data in users.items():
        if user_data.get('role') == 'OWNER' and user_data.get('status') == 'INVITED':
            owner_user = user_data
            break
    
    if not owner_user:
        print("Error: No INVITED owner user found")
        sys.exit(1)
    
    # Generate new token
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    
    import time
    token_data = {
        "id": f"invite_{int(time.time() * 1000)}_{secrets.token_urlsafe(6)}",
        "agencyId": owner_user['agencyId'],
        "userId": owner_user['id'],
        "tokenHash": token_hash,
        "expiresAt": int((time.time() + 72 * 60 * 60) * 1000),  # 72 hours
        "usedAt": None,
        "createdAt": int(time.time() * 1000)
    }
    
    # Invalidate old tokens
    for tid, tdata in invite_tokens.items():
        if tdata.get('userId') == owner_user['id'] and tdata.get('usedAt') is None:
            tdata['usedAt'] = int(time.time() * 1000)
    
    invite_tokens[token_data['id']] = token_data
    
    # Save
    with open('data/invite-tokens.json', 'w') as f:
        json.dump(invite_tokens, f, indent=2)
    
    active_token = token_data
    print(f"\n✅ Generated new invite token!")
    print(f"\n📧 Invite Link:")
    print(f"   http://localhost:8000/accept-invite.html?token={token}&agencyId={active_token['agencyId']}\n")
    sys.exit(0)

# If we have an active token but need to reverse the hash, we can't
# But we can generate a new one
print("Active token found, but we need to generate a new one to get the plain token.")
print("The hash is stored, but we can't reverse it. Generating new token...")

# Generate new token
token = secrets.token_urlsafe(32)
token_hash = hashlib.sha256(token.encode()).hexdigest()

import time
# Invalidate old token
active_token['usedAt'] = int(time.time() * 1000)

# Create new token
new_token_data = {
    "id": f"invite_{int(time.time() * 1000)}_{secrets.token_urlsafe(6)}",
    "agencyId": active_token['agencyId'],
    "userId": active_token['userId'],
    "tokenHash": token_hash,
    "expiresAt": int((time.time() + 72 * 60 * 60) * 1000),
    "usedAt": None,
    "createdAt": int(time.time() * 1000)
}

invite_tokens[new_token_data['id']] = new_token_data

# Save
with open('data/invite-tokens.json', 'w') as f:
    json.dump(invite_tokens, f, indent=2)

print(f"\n✅ Generated new invite token!")
print(f"\n📧 Invite Link:")
print(f"   http://localhost:8000/accept-invite.html?token={token}&agencyId={new_token_data['agencyId']}\n")
