"""
URL configuration for config project.
"""
from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.urls import path

# Import views directly from apps since apps are added to sys.path
from users.views import (
    CustomTokenObtainPairView,
    csrf_cookie_view,
    RegisterView,
    UserProfileView,
    StaffListView,
    StaffDetailView,
    ForgotPasswordView,
    AdminMFAResendView,
    PasswordResetVerifyOTPView,
    PasswordResetConfirmView,
    RegistrationOTPVerifyView,
    RegistrationOTPResendView,
    SystemDataResetView,
    GoogleAuthView,
    CookieTokenRefreshView,
    LogoutView,
    PrivacyConsentView,
    PrivacyRequestView,
    AdminPrivacyRequestListView,
    AdminPrivacyRequestDetailView,
    PrivacyExportView,
)
from booking.views import (
    ServiceListView, PackageListView, BookingListCreateView, BookingDetailUpdateView,
    BookingPaymentListCreateView, BookingPaymentVerifyView, BookingAvailabilityView,
    BookingPaymentOcrView, BookingPaymentReferenceCheckView,
    BookingPaymentMethodsView, BookingPaymentReceiptView,
    StudioUnavailableDateListCreateView, StudioUnavailableDateDetailView,
    BookingReviewCreateView, BookingReviewListView,
)
from inventory.views import (
    ProductListCreateView, ProductDetailUpdateView, StockMovementListView, 
    CategoryListCreateView, CategoryDetailView, SupplierListCreateView, SupplierDetailView, PurchaseOrderListCreateView,
    PurchaseOrderDetailUpdateView, IngredientListCreateView, IngredientDetailUpdateView,
    RecipeIngredientListCreateView, IngredientStockMovementListView, GenerateRecipeIngredientsView
)
from pos.views import OrderListCreateView, OrderDetailView, PaymentCreateView, EndOfDayReportListCreateView, EndOfDayReportReprintView, EndOfDayReportMarkPrintedView, EndOfDayReportSummaryView
from chatbot.views import ChatbotQueryView, FAQListCreateView, FAQDetailUpdateView
from dashboard.views import DashboardAnalyticsView
from forecasting.views import ForecastingDataView, SalesHistoryImportView
from gallery.views import GalleryImageDetailView, GalleryImageListView
from audit.views import AuditLogListView, ClientRuntimeErrorView
from config.health import health_check
from notifications.views import (
    NotificationDeliveryListView,
    NotificationListView,
    NotificationReadView,
    NotificationMarkAllReadView,
    PushConfigView,
    PushSubscriptionView,
)

urlpatterns = [
    path('health/', health_check, name='health_check'),
    path('admin/', admin.site.urls),
    
    # Auth endpoints
    path('api/auth/login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/auth/login/mfa/resend/', AdminMFAResendView.as_view(), name='auth_admin_mfa_resend'),
    path('api/auth/csrf/', csrf_cookie_view, name='auth_csrf'),
    path('api/auth/token/refresh/', CookieTokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/logout/', LogoutView.as_view(), name='auth_logout'),
    path('api/auth/register/', RegisterView.as_view(), name='auth_register'),
    path('api/auth/register/verify/', RegistrationOTPVerifyView.as_view(), name='auth_register_verify'),
    path('api/auth/register/resend/', RegistrationOTPResendView.as_view(), name='auth_register_resend'),
    path('api/auth/google/', GoogleAuthView.as_view(), name='auth_google'),
    path('api/auth/profile/', UserProfileView.as_view(), name='auth_profile'),
    path('api/privacy/consents/', PrivacyConsentView.as_view(), name='privacy_consents'),
    path('api/privacy/requests/', PrivacyRequestView.as_view(), name='privacy_requests'),
    path('api/privacy/requests/admin/', AdminPrivacyRequestListView.as_view(), name='privacy_requests_admin'),
    path('api/privacy/requests/admin/<int:pk>/', AdminPrivacyRequestDetailView.as_view(), name='privacy_request_admin_detail'),
    path('api/privacy/export/', PrivacyExportView.as_view(), name='privacy_export'),
    path('api/auth/users/', StaffListView.as_view(), name='staff_list'),
    path('api/auth/users/<int:pk>/', StaffDetailView.as_view(), name='staff_detail'),
    path('api/auth/forgot-password/', ForgotPasswordView.as_view(), name='auth_forgot_password'),
    path('api/auth/forgot-password/verify/', PasswordResetVerifyOTPView.as_view(), name='auth_forgot_password_verify'),
    path('api/auth/forgot-password/confirm/', PasswordResetConfirmView.as_view(), name='auth_forgot_password_confirm'),
    path('api/admin/system-reset/', SystemDataResetView.as_view(), name='admin_system_reset'),
    
    # Booking endpoints
    path('api/bookings/services/', ServiceListView.as_view(), name='service_list'),
    path('api/bookings/packages/', PackageListView.as_view(), name='package_list'),
    path('api/bookings/availability/', BookingAvailabilityView.as_view(), name='booking_availability'),
    path('api/bookings/payment-methods/', BookingPaymentMethodsView.as_view(), name='booking_payment_methods'),
    path('api/bookings/studio-unavailable-dates/', StudioUnavailableDateListCreateView.as_view(), name='studio_unavailable_date_list_create'),
    path('api/bookings/studio-unavailable-dates/<int:pk>/', StudioUnavailableDateDetailView.as_view(), name='studio_unavailable_date_detail'),
    path('api/bookings/', BookingListCreateView.as_view(), name='booking_list_create'),
    path('api/bookings/<int:pk>/', BookingDetailUpdateView.as_view(), name='booking_detail_update'),
    path('api/bookings/reviews/', BookingReviewCreateView.as_view(), name='booking_review_create'),
    path('api/bookings/reviews/all/', BookingReviewListView.as_view(), name='booking_review_list'),
    path('api/bookings/payments/', BookingPaymentListCreateView.as_view(), name='booking_payment_list_create'),
    path('api/bookings/payments/<int:pk>/receipt/', BookingPaymentReceiptView.as_view(), name='booking_payment_receipt'),
    path('api/bookings/payments/ocr/', BookingPaymentOcrView.as_view(), name='booking_payment_ocr'),
    path('api/bookings/payments/reference-check/', BookingPaymentReferenceCheckView.as_view(), name='booking_payment_reference_check'),
    path('api/bookings/payments/<int:pk>/verify/', BookingPaymentVerifyView.as_view(), name='booking_payment_verify'),
    
    # Inventory endpoints
    path('api/inventory/products/', ProductListCreateView.as_view(), name='product_list_create'),
    path('api/inventory/products/<int:pk>/', ProductDetailUpdateView.as_view(), name='product_detail_update'),
    path('api/inventory/ingredients/', IngredientListCreateView.as_view(), name='ingredient_list_create'),
    path('api/inventory/ingredients/<int:pk>/', IngredientDetailUpdateView.as_view(), name='ingredient_detail_update'),
    path('api/inventory/ingredient-movements/', IngredientStockMovementListView.as_view(), name='ingredient_movement_list'),
    path('api/inventory/recipes/', RecipeIngredientListCreateView.as_view(), name='recipe_ingredient_list_create'),
    path('api/inventory/recipes/generate/', GenerateRecipeIngredientsView.as_view(), name='recipe_generate'),
    path('api/inventory/movements/', StockMovementListView.as_view(), name='stock_movement_list'),
    path('api/inventory/categories/', CategoryListCreateView.as_view(), name='category_list'),
    path('api/inventory/categories/<int:pk>/', CategoryDetailView.as_view(), name='category_detail'),
    path('api/inventory/suppliers/', SupplierListCreateView.as_view(), name='supplier_list'),
    path('api/inventory/suppliers/<int:pk>/', SupplierDetailView.as_view(), name='supplier_detail'),
    path('api/inventory/purchase-orders/', PurchaseOrderListCreateView.as_view(), name='po_list'),
    path('api/inventory/purchase-orders/<int:pk>/', PurchaseOrderDetailUpdateView.as_view(), name='po_detail'),
    
    # POS endpoints
    path('api/pos/orders/', OrderListCreateView.as_view(), name='pos_orders'),
    path('api/pos/orders/<int:pk>/', OrderDetailView.as_view(), name='pos_order_detail'),
    path('api/pos/payments/', PaymentCreateView.as_view(), name='pos_payments'),
    path('api/pos/end-of-day-summary/', EndOfDayReportSummaryView.as_view(), name='pos_end_of_day_summary'),
    path('api/pos/end-of-day-reports/', EndOfDayReportListCreateView.as_view(), name='pos_end_of_day_reports'),
    path('api/pos/end-of-day-reports/<int:pk>/reprint/', EndOfDayReportReprintView.as_view(), name='pos_end_of_day_report_reprint'),
    path('api/pos/end-of-day-reports/<int:pk>/mark-printed/', EndOfDayReportMarkPrintedView.as_view(), name='pos_end_of_day_report_mark_printed'),
    
    # Chatbot endpoints
    path('api/chatbot/query/', ChatbotQueryView.as_view(), name='chatbot_query'),
    path('api/chatbot/faqs/', FAQListCreateView.as_view(), name='faq_list_create'),
    path('api/chatbot/faqs/<int:pk>/', FAQDetailUpdateView.as_view(), name='faq_detail_update'),
    
    # Analytics / Dashboard
    path('api/dashboard/analytics/', DashboardAnalyticsView.as_view(), name='dashboard_analytics'),
    path('api/forecasting/predictions/', ForecastingDataView.as_view(), name='forecasting_predictions'),
    path('api/forecasting/history/import/', SalesHistoryImportView.as_view(), name='forecasting_history_import'),
    path('api/audit/client-runtime-errors/', ClientRuntimeErrorView.as_view(), name='client_runtime_errors'),
    path('api/audit/logs/', AuditLogListView.as_view(), name='audit_log_list'),

    # Customer notifications
    path('api/notifications/', NotificationListView.as_view(), name='notification_list'),
    path('api/notifications/read-all/', NotificationMarkAllReadView.as_view(), name='notification_mark_all_read'),
    path('api/notifications/<int:pk>/read/', NotificationReadView.as_view(), name='notification_read'),
    path('api/notifications/push/config/', PushConfigView.as_view(), name='notification_push_config'),
    path('api/notifications/push/subscription/', PushSubscriptionView.as_view(), name='notification_push_subscription'),
    path('api/notifications/deliveries/', NotificationDeliveryListView.as_view(), name='notification_delivery_list'),

    # Landing gallery
    path('api/gallery/images/', GalleryImageListView.as_view(), name='gallery_image_list'),
    path('api/gallery/images/<int:pk>/', GalleryImageDetailView.as_view(), name='gallery_image_detail'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
