from datetime import date, datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from booking.models import Booking, Package, Service
from forecasting.models import ForecastRun
from inventory.models import Product
from ml.linear_regression_forecasting import create_forecast_run, evaluate_series, least_squares_predict
from payment.models import Payment
from pos.models import Order


class LinearRegressionCalculationTests(TestCase):
    def test_ordinary_least_squares_recovers_linear_sequence(self):
        predictions = least_squares_predict([3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29], 2)
        self.assertEqual(predictions, [31.0, 33.0])

    def test_chronological_evaluation_reports_mae_and_rmse(self):
        evaluation = evaluate_series([float(index) for index in range(20)])
        self.assertEqual(evaluation['status'], 'available')
        self.assertEqual(evaluation['split_index'], 16)
        self.assertEqual(evaluation['mae'], 0)
        self.assertEqual(evaluation['rmse'], 0)
        self.assertEqual(evaluate_series([1, 2, 3])['status'], 'insufficient_history')


class ForecastDataIntegrationTests(TestCase):
    def setUp(self):
        self.today = timezone.localdate()
        self.ingredient = Product.objects.create(name='Forecast milk', item_type=Product.INGREDIENT, sku='ML-FORECAST-MILK', stock_quantity=5, base_unit='ML')
        self.product = Product.objects.create(name='Forecast latte', item_type=Product.PRODUCT, sku='ML-FORECAST-LATTE', stock_level=0, recipe_data=[{'ingredient': self.ingredient.id, 'quantity': '2'}])
        self.service = Service.objects.create(name='Forecast studio', base_price='100.00')
        self.package = Package.objects.create(service=self.service, name='Forecast session', price='100.00', inclusions='Session')
        for offset in range(20):
            day = self.today - timedelta(days=19 - offset)
            order = Order.objects.create(
                total='100.00', returned_amount='10.00', payment_status='PAID',
                completed_at=timezone.make_aware(datetime.combine(day, time(12, 0))),
                line_items=[{'product': self.product.id, 'name': self.product.name, 'quantity': 3, 'returned_quantity': 1, 'net_subtotal': '100.00', 'refunded_amount': '10.00'}],
                return_events=[{'action_type': 'WASTAGE', 'product_id': self.product.id, 'quantity': 4}],
            )
            Order.objects.filter(pk=order.pk).update(created_at=timezone.make_aware(datetime.combine(day, time(12, 0))))
            booking = Booking.objects.create(package=self.package, scheduled_date=day, scheduled_time=time(10, 0), status='CONFIRMED')
            Payment.objects.create(
                payment_type=Payment.BOOKING, booking=booking, amount='10.00', status='APPROVED',
                paid_at=timezone.make_aware(datetime.combine(day, time(13, 0))),
            )
        Booking.objects.create(package=self.package, scheduled_date=self.today + timedelta(days=1), scheduled_time=time(11, 0), status='CANCELLED')

    def test_records_refunds_cancellations_wastage_and_recipe_requirements(self):
        run = create_forecast_run(horizon=7)
        report = run.predictions
        self.assertEqual(run.data_status, 'ready')
        self.assertEqual(report['sales'][0]['predicted_revenue'], 100.0)
        self.assertEqual(report['products'][0]['predicted_quantity'], 2.0)
        self.assertEqual(report['bookings'][0]['predicted_bookings'], 1.0)
        self.assertEqual(report['actual_history'][-1]['actual_wastage_units'], 4.0)
        ingredient = next(row for row in run.recommendations if row['type'] == 'ingredient')
        self.assertEqual(ingredient['forecast_requirement'], 28.0)
        self.assertEqual(ingredient['shortage'], 23.0)
        self.assertTrue(all('actual_revenue' not in row for row in report['sales']))
        self.assertEqual(run.evaluation['sales']['status'], 'available')
        self.assertEqual(run.model_version, 'least-squares-linear-v1')
        self.ingredient.refresh_from_db()
        self.assertEqual(float(self.ingredient.stock_quantity), 5.0)
        self.assertEqual(sum(event['quantity'] for order in Order.objects.all() for event in order.return_events), 80)

    def test_short_history_saves_no_fabricated_forecast(self):
        Order.objects.all().delete()
        Booking.objects.all().delete()
        Order.objects.create(total='55.00', payment_status='PAID', completed_at=timezone.now(), line_items=[])
        run = create_forecast_run()
        self.assertEqual(run.data_status, 'insufficient_history')
        self.assertEqual(run.predictions['sales'], [])
        self.assertEqual(run.recommendations, [])

    def test_forecast_endpoint_requires_existing_staff_or_admin_permission(self):
        customer = get_user_model().objects.create_user(username='forecast-customer', password='test-pass', role='CUSTOMER')
        staff = get_user_model().objects.create_user(username='forecast-staff', password='test-pass', role='STAFF')
        client = APIClient()
        client.force_authenticate(customer)
        self.assertEqual(client.get('/api/forecasting/ml/').status_code, 403)
        client.force_authenticate(staff)
        response = client.post('/api/forecasting/ml/', {'horizon_days': 7}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(ForecastRun.objects.count(), 1)
        self.assertEqual(response.data['horizon_days'], 7)
