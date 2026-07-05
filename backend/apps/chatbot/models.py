from django.db import models
from django.conf import settings

class ChatbotFAQ(models.Model):
    question = models.CharField(max_length=255)
    answer = models.TextField()
    tags = models.CharField(max_length=100, blank=True, help_text="Comma-separated keywords, e.g. hours, price, location")

    def __str__(self):
        return self.question

class ChatbotLog(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    session_id = models.CharField(max_length=100, blank=True, null=True)
    question = models.TextField()
    response = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        user_str = self.user.username if self.user else "Anonymous"
        return f"ChatbotLog #{self.id} - {user_str} at {self.timestamp.date()}"
