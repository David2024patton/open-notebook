import json
import urllib.request

def api_call(method, url, data=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"error": e.code, "detail": e.read().decode()}

# Login
login_resp = api_call("POST", "http://localhost:5055/api/auth/login",
                       {"email": "david@itak.live", "password": "Wildcats@4113"})
token = login_resp["access_token"]
print(f"Login OK, role: {login_resp['user']['role']}")

# Test /me
me = api_call("GET", "http://localhost:5055/api/auth/me", token=token)
print(f"/me OK: {me['username']} ({me['role']})")

# List signup requests
requests = api_call("GET", "http://localhost:5055/api/auth/signup-requests", token=token)
print(f"Pending requests: {len(requests)}")
for r in requests:
    print(f"  - {r['id']}: {r['username']} ({r['status']})")

# Approve testuser's request
for r in requests:
    if r["username"] == "testuser":
        review = api_call("POST", f"http://localhost:5055/api/auth/signup-requests/{r['id']}/review",
                          {"action": "approve"}, token=token)
        print(f"Approve result: {review}")
        break
