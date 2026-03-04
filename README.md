# P.M. Offset Printers — Order Tracking System

A secure web-based order tracking system for P.M. Offset Printers. Clients can track orders by ID, and admins can manage orders through a secure dashboard.

---

## 🚀 SETUP GUIDE (Step by Step)

### Step 1: Install Node.js

Node.js is the engine that runs your website. You only need to do this once.

1. Go to **https://nodejs.org**
2. Click the **green button** that says "LTS" (Long Term Support)
3. Download and install it (just click Next/Continue through the installer)
4. To verify it worked, open **Terminal** (Mac) or **Command Prompt** (Windows) and type:
   ```
   node --version
   ```
   If you see a number like `v20.x.x`, you're good!

### Step 2: Download the Project Files

Put the entire `pm-tracker` folder somewhere on your computer (e.g., your Desktop or Documents folder).

### Step 3: Install Dependencies

1. Open **Terminal** (Mac) or **Command Prompt** (Windows)
2. Navigate to the project folder:
   ```
   cd /path/to/pm-tracker
   ```
   For example, if it's on your Desktop:
   - **Mac:** `cd ~/Desktop/pm-tracker`
   - **Windows:** `cd C:\Users\YourName\Desktop\pm-tracker`
3. Type this command and press Enter:
   ```
   npm install
   ```
   Wait for it to finish (might take 30 seconds).

### Step 4: Create Your Head Admin Account

1. In the same Terminal, type:
   ```
   node setup.js
   ```
2. It will ask you:
   - **Head Admin username:** (type your username, e.g., `anish`)
   - **Head Admin password:** (type a password)
   - **Security question:** (e.g., `What is my pet's name?`)
   - **Security answer:** (e.g., `buddy`)
3. It will then ask if you want to add team members. You can add them now or later from the website.

### Step 5: Start the Website

1. In the same Terminal, type:
   ```
   npm start
   ```
2. You'll see a message saying the server is running
3. Open your browser and go to: **http://localhost:3000**
4. Your website is now live on your computer!

---

## 📱 HOW TO USE

### For Clients
- Visit the website
- Enter their Order ID in the search box
- See the full progress of their order

### For Admin/Staff
- Click the **"Login"** button on the homepage
- Enter username and password
- Create, edit, and manage orders from the dashboard
- Add notes that clients can see
- Mark orders as delayed
- Update order stages

### For Head Admin (extra features)
- **Manage Team** tab: Add/remove team members, reset passwords
- **Audit Log** tab: See who did what and when
- Can delete notes posted by any team member

---

## 🌐 DEPLOYING ONLINE (so anyone can access it)

### Option A: Railway (Recommended — ~$5/month)

1. Go to **https://railway.app** and sign up (use GitHub or Google)
2. Click **"New Project"** → **"Deploy from GitHub repo"**
   - If you haven't uploaded to GitHub yet, you can use **"Deploy from local"** instead
3. Railway will detect it's a Node.js project and deploy automatically
4. Go to **Settings** → **Networking** → **Generate Domain** to get your public URL
5. To connect your GoDaddy domain:
   - In Railway, go to **Settings** → **Networking** → **Custom Domain**
   - Add your domain (e.g., `tracking.pmoffsetprinters.com`)
   - Railway will give you a CNAME value
   - In GoDaddy DNS settings, add a **CNAME record**:
     - **Name:** `tracking` (or whatever subdomain you want)
     - **Value:** The CNAME Railway gave you
   - Wait 5-30 minutes for it to work

### Option B: Render (Free tier available)

1. Go to **https://render.com** and sign up
2. Click **"New"** → **"Web Service"**
3. Connect your GitHub repo or upload files
4. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Click **Deploy**
6. For custom domain, follow similar CNAME steps as Railway

---

## 📁 PROJECT STRUCTURE

```
pm-tracker/
├── server.js          ← Main server file
├── setup.js           ← Run this to create accounts
├── package.json       ← Project dependencies
├── db/
│   └── database.js    ← Database setup
├── middleware/
│   └── auth.js        ← Login security
├── routes/
│   ├── auth.js        ← Login/logout/forgot password
│   ├── orders.js      ← Order management
│   └── admin.js       ← Team & audit log management
├── public/
│   ├── index.html     ← Main webpage
│   ├── logo.png       ← Your logo
│   ├── css/
│   │   └── styles.css ← All styling
│   └── js/
│       ├── app.js     ← Frontend code (part 1)
│       └── app2.js    ← Frontend code (part 2)
└── data/              ← Created automatically (database lives here)
```

---

## 🔒 SECURITY FEATURES

- Passwords are **hashed with bcrypt** (never stored as plain text)
- All authentication happens **server-side** (nothing visible in browser inspect)
- Sessions are stored securely in the database
- Head admin has exclusive access to team management and audit logs

---

## ❓ TROUBLESHOOTING

**"command not found: node"**
→ Node.js isn't installed. Go to https://nodejs.org and install it.

**"Cannot find module..."**
→ You forgot to run `npm install`. Run it in the project folder.

**"Port 3000 is already in use"**
→ Something else is running on that port. Either close it or change the port:
```
PORT=4000 npm start
```

**Forgot your head admin password?**
→ Delete the `data` folder and run `node setup.js` again (this resets everything).

---

## 📞 Support

Built for P.M. Offset Printers
Phone/WhatsApp: +91 96209 56044
Email: planning@pmoffsetprinters.com
