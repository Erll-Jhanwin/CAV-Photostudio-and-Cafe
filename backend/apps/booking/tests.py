from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from booking.availability import get_available_slots, is_slot_available
from booking.models import Booking, Package, Service, StudioUnavailableDate


class BookingAvailabilityPolicyTests(TestCase):
    def setUp(self):
        self.customer = get_user_model().objects.create_user(
            username='slot-customer',
            email='slot-customer@example.com',
            password='Customer123!',
        )
        self.studio_service = Service.objects.create(
            name='Studio Session',
            description='Studio shoots',
            duration_minutes=60,
            base_price='1000.00',
        )
        self.studio_package = Package.objects.create(
            service=self.studio_service,
            name='Solo Package',
            description='Solo shoot',
            price='1000.00',
            inclusions='Studio session',
        )
        self.event_service = Service.objects.create(
            name='Photo Service Booking',
            description='Event coverage',
            duration_minutes=120,
            base_price='2500.00',
        )
        self.event_package = Package.objects.create(
            service=self.event_service,
            name='Standard Event Package',
            description='Event shoot',
            price='2500.00',
            inclusions='Event coverage',
        )
        self.future_day = timezone.localdate() + timedelta(days=14)

    def test_studio_session_has_nine_daily_slots(self):
        slots = get_available_slots(self.studio_package.id, self.future_day)

        self.assertEqual(len(slots), 9)
        self.assertEqual(slots[0]['time'], '09:00:00')
        self.assertEqual(slots[-1]['time'], '18:00:00')
        self.assertTrue(all(slot['available'] for slot in slots))

    def test_photo_service_event_has_morning_and_afternoon_slots_only(self):
        slots = get_available_slots(self.event_package.id, self.future_day)

        self.assertEqual([slot['label'] for slot in slots], ['Morning', 'Afternoon'])
        self.assertEqual([slot['time'] for slot in slots], ['09:00:00', '13:00:00'])

    def test_active_booking_disables_booked_slot(self):
        Booking.objects.create(
            customer=self.customer,
            package=self.event_package,
            scheduled_date=self.future_day,
            scheduled_time='09:00',
            status='PENDING',
        )

        event_slots = get_available_slots(self.event_package.id, self.future_day)
        self.assertEqual(event_slots[0]['status'], 'BOOKED')
        self.assertFalse(event_slots[0]['available'])
        self.assertFalse(is_slot_available(self.event_package.id, self.future_day, '09:00'))

    def test_event_package_rejects_non_event_slot_time(self):
        self.assertFalse(is_slot_available(self.event_package.id, self.future_day, '10:00'))

    def test_event_booking_makes_all_studio_slots_unavailable_for_that_date(self):
        Booking.objects.create(
            customer=self.customer,
            package=self.event_package,
            scheduled_date=self.future_day,
            scheduled_time='13:00',
            status='CONFIRMED',
        )

        studio_slots = get_available_slots(self.studio_package.id, self.future_day)

        self.assertEqual(len(studio_slots), 9)
        self.assertTrue(all(slot['status'] == 'STUDIO_UNAVAILABLE' for slot in studio_slots))
        self.assertTrue(all(slot['notice'] == 'Unavailable due to an event photoshoot.' for slot in studio_slots))
        self.assertFalse(any(slot['available'] for slot in studio_slots))

    def test_manual_studio_unavailable_date_blocks_studio_slots_with_reason(self):
        StudioUnavailableDate.objects.create(
            date=self.future_day,
            reason='Studio maintenance',
            created_by=self.customer,
        )

        studio_slots = get_available_slots(self.studio_package.id, self.future_day)
        event_slots = get_available_slots(self.event_package.id, self.future_day)

        self.assertTrue(all(slot['status'] == 'STUDIO_UNAVAILABLE' for slot in studio_slots))
        self.assertTrue(all(slot['notice'] == 'Studio maintenance' for slot in studio_slots))
        self.assertTrue(all(slot['available'] for slot in event_slots))

    def test_event_slots_are_unavailable_when_studio_session_already_exists_that_day(self):
        Booking.objects.create(
            customer=self.customer,
            package=self.studio_package,
            scheduled_date=self.future_day,
            scheduled_time='18:00',
            status='CONFIRMED',
        )

        event_slots = get_available_slots(self.event_package.id, self.future_day)

        self.assertFalse(any(slot['available'] for slot in event_slots))
        self.assertTrue(all(slot['notice'] == 'Studio sessions already booked on this date.' for slot in event_slots))
