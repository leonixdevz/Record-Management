# Record Management System

A full-stack web application for managing custom data collections and records. Create collections with defined schemas, then add, view, edit, and search records within those collections.

## Features

**Authentication**
- Secure login/logout system with token-based authentication
- Protected API routes requiring authentication

**Collection Management**
- Create custom collections with configurable schemas (fields)
- Define field types: text, number, email, date, boolean
- Mark fields as required or optional
- View all collections on dashboard with record counts
- Edit or delete existing collections

**Record Management**
- Add new records to any collection following its schema
- View all records in a collection in a searchable table
- Edit existing records
- Delete records
- Search records by any field
- Export collection data as JSON file
- Import records from JSON file
- Deduplicate records by specifying a field to check for duplicates

## Tech Stack

| Layer    | Technology              |
|----------|-------------------------|
| Frontend | HTML5, CSS3, Vanilla JS |
| Backend  | Node.js, Express.js     |
| Database | SQLite                  |
| Auth     | JWT-style token (simple implementation) |

## Project Structure

```
record-management/
├── server.js             # Express API server
├── package.json          # Node.js dependencies and scripts
├── public/               # Static frontend files
│   ├── index.html        # Login page
│   ├── dashboard.html    # Collections dashboard
│   ├── records.html      # Record management view
│   ├── css/              # Stylesheets
│   │   └── style.css     # Main stylesheet
│   └── js/               # JavaScript files
│       └── app.js        # API wrapper and page-specific logic
├── data/                 # SQLite database directory
│   └── record_management.db
├── README.md             # This file
└── .gitignore            # Git ignore rules
```

## How to Run

### Prerequisites
- Node.js (v14+ recommended)
- npm (comes with Node.js)

### Installation & Setup

1. **Clone or download the repository**
   ```bash
   git clone <repository-url>
   cd record-management
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the server**
   ```bash
   npm start
   ```
   The server will start on `http://localhost:3000`

4. **Open the application**
   - Navigate to `http://localhost:3000` in your web browser
   - Login with the default credentials:
     - Username: `admin`
     - Password: `admin123`

> **Important**: For security, change the default admin password in `server.js` before deploying to production.

## API Endpoints

All API endpoints are prefixed with `/api` and require authentication (except login/logout).

### Authentication
| Method | Endpoint     | Description          |
|--------|--------------|----------------------|
| POST   | `/api/login` | Login with username/password |
| POST   | `/api/logout`| Logout and clear token |

### Collections
| Method | Endpoint                 | Description                     |
|--------|--------------------------|---------------------------------|
| GET    | `/api/collections`       | Get all collections with counts |
| POST   | `/api/collections`       | Create a new collection         |
| PUT    | `/api/collections/:id`   | Update a collection             |
| DELETE | `/api/collections/:id`   | Delete a collection             |

### Records
| Method | Endpoint                         | Description                     |
|--------|----------------------------------|---------------------------------|
| GET    | `/api/records/:colId`            | Get all records in a collection |
| POST   | `/api/records/:colId`            | Add a new record                |
| PUT    | `/api/records/:colId/:recId`     | Update a record                 |
| DELETE | `/api/records/:colId/:recId`     | Delete a record                 |
| GET    | `/api/records/:colId/export`     | Export collection records as JSON |
| POST   | `/api/records/:colId/import`     | Import records from JSON        |
| POST   | `/api/records/:colId/deduplicate`| Remove duplicate records by field |

### Collection Schema
Collections are defined by a JSON array of field objects. Each field object has:
- `id` (string): Unique identifier for the field
- `name` (string): Database field name
- `label` (string): Display name for the field
- `type` (string): Field type (`text`, `number`, `email`, `date`, `boolean`)
- `required` (boolean): Whether the field is required

Example schema:
```json
[
  {
    "id": "full_name",
    "name": "full_name",
    "label": "Full Name",
    "type": "text",
    "required": true
  },
  {
    "id": "email",
    "name": "email",
    "label": "Email Address",
    "type": "email",
    "required": false
  }
]
```

## Default Admin Credentials
- **Username**: `admin`
- **Password**: `admin123`

## Security Notes
- Passwords are hashed using SHA-256 with a salt before storage
- Authentication tokens are checked on all protected routes
- The default admin credentials should be changed before production use
- API endpoints validate input data and return appropriate error messages

## Database
The application uses SQLite for data storage. The database file is automatically created in the `data/` directory on first run and contains:
- `users` table: Stores admin user information
- `collections` table: Stores collection definitions and schemas
- `records` table: Stores individual records linked to collections

## Customization
To customize the application:
1. **Change styling**: Modify `public/css/style.css`
2. **Add new features**: Edit `server.js` for backend API, `public/js/app.js` for frontend logic
3. **Change default admin**: Modify the user initialization code in `server.js`
4. **Adjust port**: Change the `PORT` constant in `server.js`

## Development
To modify and rebuild:
1. Make changes to the source files
2. Restart the server (`npm restart` or stop/start with `npm start`)
3. Refresh your browser to see changes

## Project Status
This is a commissioned academic project developed for a specific client. 
All rights reserved. Not for redistribution or modification without explicit permission from the client.