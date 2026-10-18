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

  Prompt generator starter:
  
  Create a short, clear, and concise prompt about this. Also in the prompt it will say to maximize the codex power.


  Prompt for checking the status of the system:

  Analyze the entire project and create a Project Progress Dashboard showing the overall completion percentage, completed features, ongoing tasks, pending features, and identified issues. Calculate progress based on actual implementation, not assumptions. Evaluate each module and feature, verify functionality where possible, and display progress using a percentage, progress bar, and clear status indicators. Include a breakdown by module, remaining tasks, and recommended next steps. Do not modify existing code, database structures, or functionality.