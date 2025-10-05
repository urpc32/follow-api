from flask import Flask, jsonify, request
import requests
import random
import string
import os

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
    from RoPy import RoPy  # Import here for Vercel compatibility
    bot = RoPy()
    funcaptcha_token = solve_nopecha_funcaptcha()
    if not funcaptcha_token:
        return jsonify({"error": "CAPTCHA solve failed"}), 500

    username = ''.join(random.choice(string.ascii_lowercase) for _ in range(10))
    password = ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(12))
    success = bot.Register(
        user_name=username,
        pass_word=password,
        fun_captcha=funcaptcha_token,
        birth_day=1,
        birth_month=1,
        birth_year=2000,
        gender=1
    )
    if success and bot.Login(roblo_security=""):
        return jsonify({
            "username": username,
            "password": password,
            "cookie": bot.get_cookie()
        })
    return jsonify({"error": "Account creation or login failed"}), 500

@app.route('/follow', methods=['POST'])
def follow_user():
    data = request.json
    cookie = data.get("cookie")
    user_id = data.get("user_id")
    name = data.get("name", "unknown")

    if not cookie or not user_id:
        return jsonify({"error": "Missing cookie or user_id"}), 400

    response = requests.post(
        "https://auth.roblox.com/v1/logout",
        headers={"Cookie": f".ROBLOSECURITY={cookie}"}
    )
    token = response.headers.get("x-csrf-token")
    if not token:
        return jsonify({"error": f"{name} could not get CSRF token"}), 500

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

# Vercel serverless handler
from serverless_wsgi import handle_request
def handler(event, context):
    return handle_request(app, event, context)
