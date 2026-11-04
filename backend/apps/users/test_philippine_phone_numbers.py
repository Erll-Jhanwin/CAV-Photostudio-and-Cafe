from django.test import SimpleTestCase
from rest_framework.exceptions import ValidationError

from users.models import CustomUser
from users.phone_numbers import normalize_philippine_mobile_number, validate_philippine_mobile_number
from users.serializers import validate_phone_number_format


class PhilippineMobileNumberValidationTests(SimpleTestCase):
    def test_accepts_local_11_digit_number_and_preserves_leading_zero(self):
        value = validate_philippine_mobile_number('09876543122')
        self.assertEqual(value, '09876543122')
        self.assertEqual(validate_phone_number_format(value), value)

    def test_rejects_letters_symbols_and_wrong_lengths(self):
        for value in (
            '0987654312',
            '098765431222',
            '+639876543122',
            '098-7654-3122',
            '098 7654 3122',
            ' 09876543122',
            '09876543122 ',
            '09876543abc',
            '11876543122',
        ):
            with self.subTest(value=value):
                self.assertIsNone(validate_philippine_mobile_number(value))

    def test_phone_serializer_does_not_trim_spaces_into_a_valid_number(self):
        for value in (' 09876543122', '09876543122 '):
            with self.subTest(value=value):
                with self.assertRaises(ValidationError):
                    validate_phone_number_format(value)

    def test_sms_format_is_converted_separately_from_stored_local_format(self):
        self.assertEqual(normalize_philippine_mobile_number('09876543122'), '639876543122')

    def test_account_phone_field_is_stored_as_text(self):
        self.assertEqual(CustomUser._meta.get_field('phone_number').get_internal_type(), 'CharField')
