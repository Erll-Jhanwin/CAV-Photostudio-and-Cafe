from django.core.management.base import BaseCommand
from ml.forecasting_engine import train_and_forecast_sales, train_and_forecast_demand

class Command(BaseCommand):
    help = 'Runs the Machine Learning model training and generates sales and demand forecasts for the next 7 days.'

    def handle(self, *args, **options):
        self.stdout.write('Starting ML forecasting training and predictions...')
        
        sales_result = train_and_forecast_sales()
        self.stdout.write(sales_result)
        
        demand_result = train_and_forecast_demand()
        self.stdout.write(demand_result)
        
        self.stdout.write(self.style.SUCCESS('Forecasting completed successfully!'))
