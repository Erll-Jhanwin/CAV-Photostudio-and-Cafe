"""
Management command to seed CAV Photo Studio services and packages.

Services:
  1. Studio Session - Standard studio photo session packages
  2. Photo Service Booking - Full-service booking for events/extended photoshoots

Packages under Studio Session:
  Solo Package           - 1 person  / 5 shots   - PHP 1,000
  Mr. & Ms. / Couple     - 2 persons / 10 shots  - PHP 1,000
  Mr. & Ms. Friends      - 3-5 persons / 15 shots - PHP 1,000
  Family Package         - 2-6 persons / 15 shots - PHP 1,500
  Birthday Package       - 1-4 persons / 15 shots - PHP 1,500

Usage:
  python manage.py seed_packages            # safe upsert (default)
  python manage.py seed_packages --reset    # wipe all services/packages first
"""

from django.core.management.base import BaseCommand
from booking.models import Service, Package


SERVICES = [
    {
        "name": "Studio Session",
        "description": (
            "Standard studio photo session packages. "
            "Good for solo, couple, family, birthdays, and quick studio shoots."
        ),
        "duration_minutes": 60,
        "base_price": 1000.00,
        "image_url": "https://images.unsplash.com/photo-1542038784456-1ea8e935640e?q=80&w=600",
        "packages": [
            {
                "name": "Solo Package",
                "description": "1 person / 5 shots",
                "price": 1000.00,
                "inclusions": (
                    "1 person, 5 shots, studio lighting, "
                    "backdrop selection, basic retouching, digital soft copies"
                ),
            },
            {
                "name": "Mr. & Ms. / Couple Package",
                "description": "2 persons / 10 shots",
                "price": 1000.00,
                "inclusions": (
                    "2 persons, 10 shots, studio lighting, "
                    "backdrop selection, basic retouching, digital soft copies"
                ),
            },
            {
                "name": "Mr. & Ms. Friends Package",
                "description": "3-5 persons / 15 shots",
                "price": 1000.00,
                "inclusions": (
                    "3-5 persons, 15 shots, studio lighting, "
                    "backdrop selection, basic retouching, digital soft copies"
                ),
            },
            {
                "name": "Family Package",
                "description": "2-6 persons / 15 shots",
                "price": 1500.00,
                "inclusions": (
                    "2-6 persons, 15 shots, studio lighting, "
                    "backdrop selection, basic retouching, digital soft copies"
                ),
            },
            {
                "name": "Birthday Package",
                "description": "1-4 persons / 15 shots",
                "price": 1500.00,
                "inclusions": (
                    "1-4 persons, 15 shots, studio lighting, "
                    "backdrop selection, basic retouching, digital soft copies, birthday props"
                ),
            },
        ],
    },
    {
        "name": "Photo Service Booking",
        "description": (
            "Full-service booking process for events and extended photoshoots. "
            "Includes event/program, booking confirmation, availability, "
            "shoot layout, setup, printing, and final file record."
        ),
        "duration_minutes": 120,
        "base_price": 2500.00,
        "image_url": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=600",
        "packages": [
            {
                "name": "Standard Event Package",
                "description": "2 hours event/program photoshoot",
                "price": 2500.00,
                "inclusions": (
                    "2 hours coverage, availability validation, layout setup, "
                    "printing coordination, final digital file record"
                ),
            }
        ],
    },
]


class Command(BaseCommand):
    help = "Seed CAV Photo Studio services and studio packages into the database."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete all existing services and packages before seeding.",
        )

    def handle(self, *args, **options):
        if options["reset"]:
            pkg_count, _ = Package.objects.all().delete()
            svc_count, _ = Service.objects.all().delete()
            self.stdout.write(
                self.style.WARNING(
                    f"Deleted {svc_count} service(s) and {pkg_count} package(s)."
                )
            )

        created_services = 0
        updated_services = 0
        created_packages = 0
        updated_packages = 0

        for svc_data in SERVICES:
            service, svc_created = Service.objects.update_or_create(
                name=svc_data["name"],
                defaults={
                    "description":    svc_data["description"],
                    "duration_minutes": svc_data["duration_minutes"],
                    "base_price":     svc_data["base_price"],
                    "image_url":      svc_data.get("image_url", ""),
                },
            )
            if svc_created:
                created_services += 1
                self.stdout.write(
                    self.style.SUCCESS(f"  [+] Service created: {service.name}")
                )
            else:
                updated_services += 1
                self.stdout.write(f"  [~] Service exists: {service.name}")

            for pkg_data in svc_data["packages"]:
                package, pkg_created = Package.objects.update_or_create(
                    service=service,
                    name=pkg_data["name"],
                    defaults={
                        "description": pkg_data["description"],
                        "price":       pkg_data["price"],
                        "inclusions":  pkg_data["inclusions"],
                    },
                )
                if pkg_created:
                    created_packages += 1
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"      [+] Package created: {package.name} @ PHP {package.price}"
                        )
                    )
                else:
                    updated_packages += 1
                    self.stdout.write(
                        f"      [~] Package updated: {package.name} @ PHP {package.price}"
                    )

        self.stdout.write("")
        self.stdout.write(
            self.style.SUCCESS(
                f"Seeding complete -- "
                f"Services: {created_services} created, {updated_services} updated | "
                f"Packages: {created_packages} created, {updated_packages} updated."
            )
        )
