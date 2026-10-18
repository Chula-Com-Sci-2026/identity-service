# Identity Service

For the runnable Deliverable 4 branch, updated setup, API compatibility and automated tests, start with [DELIVERABLE_4_INTEGRATION.md](DELIVERABLE_4_INTEGRATION.md). The earlier examples below describe the original service; use the new guide for current Compose/configuration commands.

An Authentication & Identity Management microservice built with **Node.js (Express)**. It leverages **RabbitMQ** for asynchronous background notification processing (Email and SMS delivery via a dedicated background Worker), all containerized with **Docker Compose**.

## 🏗 System Architecture

```
[ Frontend / Postman ]
        │
        │ HTTP REST API (Port 5000)
        ▼
┌────────────────────────────────────────────────────────┐
│  identity_service (Express API)                        │
│  - User Authentication & JWT Management                │
│  - OTP Generation & Hashing (SHA-256)                  │
│  - Message Publishing                                  │
└──────────┬─────────────────────────────┬───────────────┘
           │                             │
   SQL Queries (Port 5432)        AMQP (Port 5672)
           │                             │
           ▼                             ▼
┌──────────────────────┐      ┌──────────────────────────┐
│  PostgreSQL Database │      │  identity_rabbitmq       │
│  - users             │      │  - notification_queue    │
│  - otps              │      └──────────┬───────────────┘
└──────────────────────┘                 │
                                  Consume Messages
                                         │
                                         ▼
                              ┌──────────────────────────┐
                              │  identity_worker         │
                              │  - Background Consumer   │
                              │  - Nodemailer (Gmail)    │
                              │  - SMS Dispatcher        │
                              └──────────────────────────┘
```

## 📁 Project Structure

```
IDENTITY-SERVICE/
├── config/
│   ├── config.env              # Environment Variables
│   ├── db.js                  # Database Connection (PostgreSQL Pool)
│   └── rabbitmq.js            # Producer for connecting and pushing jobs to RabbitMQ
├── controllers/
│   └── auth.js                # Auth Controller & Business Logic
├── database/
│   └── identify-service-db    # Database(PostgreSQL)
├── middleware/
│   └── auth.js                # JWT Verification Middleware (protect)
├── models/
│   └── user.js                # Data Queries & Schema Definitions
├── postman/
│   └── postman_collection.js  # API Collection
├── routes/
│   └── auth.js                # Express Route Declarations
├── utils/
│   ├── sendEmail.js           # Email Utility (Nodemailer with SMTP/SSL)
│   └── sendSms.js             # SMS Utility
├── workers/
│   └── notificationWorker.js  # Background Worker consuming queue messages
├── .dockerignore
├── .gitignore
├── docker-compose.yml         # Container Orchestration (RabbitMQ, API, Worker)
├── Dockerfile                 # Node.js Container Definition
├── package.json
└── server.js                  # Express Application Entry Point
```
## 🚀 Running with Docker Compose (Quick Start)

### 1. Build and Start All Containers

Run this command from the project root:

```bash
docker compose up -d --build
```

### 2. Verify Container Status

```bash
docker compose ps
```

You should see all 3 services running:
* `identity_rabbitmq` (Ports `5672`, `15672` - Status: **Healthy**)
* `identity_service` (Port `5000:5000` - Status: **Up**)
* `identity_worker` (Status: **Up**)

### 3. Inspect Container Logs

```bash
# View API Server logs
docker logs -f identity_service

# View Notification Worker logs (Email/SMS dispatch)
docker logs -f identity_worker

# View all services combined
docker compose logs -f
```

### 4. RabbitMQ Management Dashboard

Open your browser and navigate to:
* **URL:** `http://localhost:15672`
* **Username:** `guest`
* **Password:** `guest`
* Go to the **Queues** tab to monitor `notification_queue` activity.

## 📡 API Endpoints (Folder: postman)

**Base URL:** `http://localhost:5000/api/v1/auth`

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/register` | Register a new user |
| `POST` | `/email/send-otp` | Send email verification OTP |
| `POST` | `/email/verify-otp` | Verify email OTP |
| `POST` | `/phone/send-otp` | Send SMS verification OTP |
| `POST` | `/phone/verify-otp` | Verify SMS OTP |
| `POST` | `/login` | Authenticate user & issue tokens |
| `POST` | `/logout` | Log out and revoke refresh token |
| `POST` | `/refresh-token` | Generate new access token |
| `POST` | `/request-password-reset` | Request reset OTP via email |
| `POST` | `/password-reset` | Reset password using OTP |
| `POST` | `/lock-account` | Lock/Unlock account (Protected) |

## 🧪 Postman Testing Workflow

1. **Configure Environment Variables:**
   * Create an environment in Postman named `Identity Service Local`.
   * Add variables:
     * `baseUrl`: `http://localhost:5000/api/v1/auth`
     * `accessToken`: (Store the token received upon login)

2. **Test Asynchronous Password Reset Flow:**
   * Invoke `POST {{baseUrl}}/request-password-reset`.
   * Check your terminal logs:
     ```bash
     docker logs -f identity_worker
     ```
     You will observe the worker picking up the task from `notification_queue` and sending the email.
   * Open the destination inbox to retrieve the 6-digit OTP code.
   * Invoke `POST {{baseUrl}}/password-reset` with the OTP code and new password.
