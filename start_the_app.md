Use two PowerShell terminals.

  Backend:

  cd "C:\Users\Erll\OneDrive\Desktop\Cav Photo Studio & Cafe - Copy\backend"

  .\venv\Scripts\Activate.ps1
  python manage.py migrate
  python manage.py runserver 8000

  Backend API: http://localhost:8000

  If activation is blocked, use:

  .\venv\Scripts\python.exe manage.py migrate
  .\venv\Scripts\python.exe manage.py runserver 8000

  Frontend:

  cd "C:\Users\Erll\OneDrive\Desktop\Cav Photo Studio & Cafe - Copy\frontend"
  npm start

  Frontend: http://localhost:3000

  The frontend is already configured to use http://localhost:8000 as its local backend API.