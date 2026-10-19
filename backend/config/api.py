import logging
import traceback

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler


logger = logging.getLogger('django.request')


def secure_exception_handler(exc, context):
    """Avoid exposing implementation details for unexpected API failures."""
    response = exception_handler(exc, context)
    if response is not None:
        return response

    view = context.get('view')
    request = context.get('request')
    frames = [(frame.filename, frame.lineno, frame.name) for frame in traceback.extract_tb(exc.__traceback__)]
    logger.error(
        'Unhandled API exception in %s method=%s path=%s user_id=%s exception_type=%s sqlstate=%s frames=%s.',
        view.__class__.__name__ if view else 'unknown view',
        getattr(request, 'method', 'unknown'),
        getattr(request, 'path', 'unknown'),
        getattr(getattr(request, 'user', None), 'id', None),
        type(exc).__name__,
        getattr(exc.__cause__, 'pgcode', None),
        frames,
    )
    return Response(
        {'detail': 'Unable to process this request. Please try again later.'},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
