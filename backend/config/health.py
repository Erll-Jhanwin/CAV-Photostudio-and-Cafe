from django.db import connection
from django.http import JsonResponse


def health_check(request):
    if request.method != 'GET':
        return JsonResponse({'detail': 'Method not allowed.'}, status=405)
    try:
        connection.ensure_connection()
    except Exception:
        return JsonResponse({'status': 'degraded'}, status=503, headers={'Cache-Control': 'no-store'})
    return JsonResponse({'status': 'ok', 'database': 'ok'}, headers={'Cache-Control': 'no-store'})
