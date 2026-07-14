"""
URL configuration for config project.
"""
from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

# Import views directly from apps since apps are added to sys.path
from users.views import CustomTokenObtainPairView, RegisterView, UserProfileView, StaffListView, ForgotPasswordView, GoogleAuthView
from booking.views import (
    ServiceListView, PackageListView, BookingListCreateView, BookingDetailUpdateView,
    BookingPaymentListCreateView, BookingPaymentVerifyView, BookingAvailabilityView
)
from inventory.views import (
    ProductListCreateView, ProductDetailUpdateView, StockMovementListView, 
    CategoryListCreateView, SupplierListCreateView, PurchaseOrderListCreateView, 
    PurchaseOrderDetailUpdateView, IngredientListCreateView, IngredientDetailUpdateView,
    RecipeIngredientListCreateView, IngredientStockMovementListView, GenerateRecipeIngredientsView
)
from pos.views import OrderListCreateView, OrderDetailView, PaymentCreateView, EndOfDayReportListCreateView, EndOfDayReportReprintView
from chatbot.views import ChatbotQueryView, FAQListCreateView, FAQDetailUpdateView
from dashboard.views import DashboardAnalyticsView
from forecasting.views import ForecastingDataView
from gallery.views import GalleryImageListView

urlpatterns = [
    path('admin/', admin.site.urls),
    
    # Auth endpoints
    path('api/auth/login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/auth/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/register/', RegisterView.as_view(), name='auth_register'),
    path('api/auth/google/', GoogleAuthView.as_view(), name='auth_google'),
    path('api/auth/profile/', UserProfileView.as_view(), name='auth_profile'),
    path('api/auth/users/', StaffListView.as_view(), name='staff_list'),
    path('api/auth/forgot-password/', ForgotPasswordView.as_view(), name='auth_forgot_password'),
    
    # Booking endpoints
    path('api/bookings/services/', ServiceListView.as_view(), name='service_list'),
    path('api/bookings/packages/', PackageListView.as_view(), name='package_list'),
    path('api/bookings/availability/', BookingAvailabilityView.as_view(), name='booking_availability'),
    path('api/bookings/', BookingListCreateView.as_view(), name='booking_list_create'),
    path('api/bookings/<int:pk>/', BookingDetailUpdateView.as_view(), name='booking_detail_update'),
    path('api/bookings/payments/', BookingPaymentListCreateView.as_view(), name='booking_payment_list_create'),
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
    path('api/inventory/suppliers/', SupplierListCreateView.as_view(), name='supplier_list'),
    path('api/inventory/purchase-orders/', PurchaseOrderListCreateView.as_view(), name='po_list'),
    path('api/inventory/purchase-orders/<int:pk>/', PurchaseOrderDetailUpdateView.as_view(), name='po_detail'),
    
    # POS endpoints
    path('api/pos/orders/', OrderListCreateView.as_view(), name='pos_orders'),
    path('api/pos/orders/<int:pk>/', OrderDetailView.as_view(), name='pos_order_detail'),
    path('api/pos/payments/', PaymentCreateView.as_view(), name='pos_payments'),
    path('api/pos/end-of-day-reports/', EndOfDayReportListCreateView.as_view(), name='pos_end_of_day_reports'),
    path('api/pos/end-of-day-reports/<int:pk>/reprint/', EndOfDayReportReprintView.as_view(), name='pos_end_of_day_report_reprint'),
    
    # Chatbot endpoints
    path('api/chatbot/query/', ChatbotQueryView.as_view(), name='chatbot_query'),
    path('api/chatbot/faqs/', FAQListCreateView.as_view(), name='faq_list_create'),
    path('api/chatbot/faqs/<int:pk>/', FAQDetailUpdateView.as_view(), name='faq_detail_update'),
    
    # Analytics / Dashboard
    path('api/dashboard/analytics/', DashboardAnalyticsView.as_view(), name='dashboard_analytics'),
    path('api/forecasting/predictions/', ForecastingDataView.as_view(), name='forecasting_predictions'),

    # Landing gallery
    path('api/gallery/images/', GalleryImageListView.as_view(), name='gallery_image_list'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
