"""
URL configuration for config project.
"""
from django.contrib import admin
from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

# Import views directly from apps since apps are added to sys.path
from users.views import CustomTokenObtainPairView, RegisterView, UserProfileView, StaffListView, ForgotPasswordView
from booking.views import ServiceListView, PackageListView, BookingListCreateView, BookingDetailUpdateView
from inventory.views import (
    ProductListCreateView, ProductDetailUpdateView, StockMovementListView, 
    CategoryListCreateView, SupplierListCreateView, PurchaseOrderListCreateView, 
    PurchaseOrderDetailUpdateView
)
from pos.views import OrderListCreateView, OrderDetailView, PaymentCreateView
from chatbot.views import ChatbotQueryView, FAQListCreateView, FAQDetailUpdateView
from dashboard.views import DashboardAnalyticsView
from forecasting.views import ForecastingDataView

urlpatterns = [
    path('admin/', admin.site.urls),
    
    # Auth endpoints
    path('api/auth/login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/auth/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/register/', RegisterView.as_view(), name='auth_register'),
    path('api/auth/profile/', UserProfileView.as_view(), name='auth_profile'),
    path('api/auth/users/', StaffListView.as_view(), name='staff_list'),
    path('api/auth/forgot-password/', ForgotPasswordView.as_view(), name='auth_forgot_password'),
    
    # Booking endpoints
    path('api/bookings/services/', ServiceListView.as_view(), name='service_list'),
    path('api/bookings/packages/', PackageListView.as_view(), name='package_list'),
    path('api/bookings/', BookingListCreateView.as_view(), name='booking_list_create'),
    path('api/bookings/<int:pk>/', BookingDetailUpdateView.as_view(), name='booking_detail_update'),
    
    # Inventory endpoints
    path('api/inventory/products/', ProductListCreateView.as_view(), name='product_list_create'),
    path('api/inventory/products/<int:pk>/', ProductDetailUpdateView.as_view(), name='product_detail_update'),
    path('api/inventory/movements/', StockMovementListView.as_view(), name='stock_movement_list'),
    path('api/inventory/categories/', CategoryListCreateView.as_view(), name='category_list'),
    path('api/inventory/suppliers/', SupplierListCreateView.as_view(), name='supplier_list'),
    path('api/inventory/purchase-orders/', PurchaseOrderListCreateView.as_view(), name='po_list'),
    path('api/inventory/purchase-orders/<int:pk>/', PurchaseOrderDetailUpdateView.as_view(), name='po_detail'),
    
    # POS endpoints
    path('api/pos/orders/', OrderListCreateView.as_view(), name='pos_orders'),
    path('api/pos/orders/<int:pk>/', OrderDetailView.as_view(), name='pos_order_detail'),
    path('api/pos/payments/', PaymentCreateView.as_view(), name='pos_payments'),
    
    # Chatbot endpoints
    path('api/chatbot/query/', ChatbotQueryView.as_view(), name='chatbot_query'),
    path('api/chatbot/faqs/', FAQListCreateView.as_view(), name='faq_list_create'),
    path('api/chatbot/faqs/<int:pk>/', FAQDetailUpdateView.as_view(), name='faq_detail_update'),
    
    # Analytics / Dashboard
    path('api/dashboard/analytics/', DashboardAnalyticsView.as_view(), name='dashboard_analytics'),
    path('api/forecasting/predictions/', ForecastingDataView.as_view(), name='forecasting_predictions'),
]
