from django.db import migrations, models


def deactivate_glossy_a4_paper(apps, schema_editor):
    Product = apps.get_model('inventory', 'Product')
    Product.objects.filter(name='Premium Glossy A4 Paper').update(is_active=False)


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0004_ingredient_ingredientstockmovement_recipeingredient'),
    ]

    operations = [
        migrations.AddField(
            model_name='product',
            name='is_active',
            field=models.BooleanField(default=True),
        ),
        migrations.RunPython(deactivate_glossy_a4_paper, migrations.RunPython.noop),
    ]
