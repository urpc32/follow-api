from flask import Flask, jsonify, request
import requests
import random
import string
import os
import time

app = Flask(__name__)

# NopeCHA solver config
NOPECHA_KEY = os.environ.get('NOPECHA_KEY')  # Set in Vercel dashboard
ROBLOX_SITE_KEY = "A2A14B1D-1AF3-C791-9BBC-EE33CC7A0A6F"

def solve_nopecha_funcaptcha():
    payload = {
        "key": NOPECHA_KEY,
        "type": "funcaptcha",
        "sitekey": ROBLOX_SITE_KEY,
        "url": "https://www.roblox.com"
    }
    response = requests.post("https://api.nopecha.com", json=payload)
    if response.json().get("data"):
        return response.json()["data"]["token"]
    return None

@app.route('/create-account', methods=['GET'])
def create_account():
    # Generate random credentials
    username = ''.join(random.choice(string.ascii_lowercase) for _ in range(10))
    password = ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(12))
    
    # Solve CAPTCHA
    funcaptcha_token = solve_nopecha_funcaptcha()
    if not funcaptcha_token:
        return jsonify({"error": "CAPTCHA solve failed"}), 500

    # Register account
    register_payload = {
        "username": username,
        "password": password,
        "birthday": "2000-01-01",
        "gender": 1,
        "isTosAgreementBoxChecked": True,
        "arkoseToken": funcaptcha_token
    }
    try:
        register_response = requests.post(
            "https://auth.roblox.com/v2/signup",
            json=register_payload,
            headers={"Content-Type": "application/json"}
        )
        if register_response.status_code != 200:
            return jsonify({"error": f"Account creation failed: {register_response.text}"}), 500
    except requests.RequestException as e:
        return jsonify({"error": f"Registration request failed: {str(e)}"}), 500

    # Log in to get cookie
    login_payload = {
        "cvalue": username,
        "ctype": "Username",
        "password": password
    }
    try:
        login_response = requests.post(
            "https://auth.roblox.com/v2/login",
            json=login_payload,
            headers={"Content-Type": "application/json"}
        )
        if login_response.status_code == 200:
            cookie = login_response.cookies.get(".ROBLOSECURITY")
            if cookie:
                return jsonify({
                    "username": username,
                    "password": password,
                    "cookie": cookie
                })
            return jsonify({"error": "No cookie returned"}), 500
        return jsonify({"error": f"Login failed: {login_response.text}"}), 500
    except requests.RequestException as e:
        return jsonify({"error": f"Login request failed: {str(e)}"}), 500

@app.route('/follow', methods=['POST'])
def follow_user():
    data = request.json
    cookie = data.get("cookie")
    user_id = data.get("user_id")
    name = data.get("name", "unknown")

    if not cookie or not user_id:
        return jsonify({"error": "Missing cookie or user_id"}), 400

    # Get CSRF token
    try:
        response = requests.post(
            "https://auth.roblox.com/v1/logout",
            headers={"Cookie": f".ROBLOSECURITY={cookie}"}
        )
        token = response.headers.get("x-csrf-token")
        if not token:
            return jsonify({"error": f"{name} could not get CSRF token"}), 500
    except requests.RequestException as e:
        return jsonify({"error": f"{name} CSRF request failed: {str(e)}"}), 500

    # Try follow request
    try:
        follow_response = requests.post(
            f"https://friends.roblox.com/v1/users/{user_id}/follow",
            headers={
                "Cookie": f".ROBLOSECURITY={cookie}",
                "x-csrf-token": token,
                "Content-Type": "application/json"
            }
        )
        if follow_response.status_code == 403 and "Challenge is required" in follow_response.text:
            funcaptcha_token = solve_nopecha_funcaptcha()
            if not funcaptcha_token:
                return jsonify({"error": f"{name} - CAPTCHA solve failed for user {user_id}"}), 500
            follow_response = requests.post(
                f"https://friends.roblox.com/v1/users/{user_id}/follow",
                headers={
                    "Cookie": f".ROBLOSECURITY={cookie}",
                    "x-csrf-token": token,
                    "Content-Type": "application/json"
                },
                json={"arkoseToken": funcaptcha_token}
            )

        if follow_response.status_code == 200:
            return jsonify({
                "success": True,
                "name": name,
                "user_id": user_id,
                "response": follow_response.json()
            })
        return jsonify({
            "success": False,
            "name": name,
            "user_id": user_id,
            "error": f"Status: {follow_response.status_code}, Body: {follow_response.text}"
        }), follow_response.status_code
    except requests.RequestException as e:
        return jsonify({"error": f"{name} Follow request failed: {str(e)}"}), 500

# Vercel serverless handler
from serverless_wsgi import handle_request
def handler(event, context):
    return handle_request(app, event, context)
