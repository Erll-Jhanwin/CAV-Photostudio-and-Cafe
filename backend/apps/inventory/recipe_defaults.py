from decimal import Decimal

from inventory.models import Category, Ingredient, Product, RecipeIngredient


INGREDIENTS = {
    "Espresso": {"base_unit": "ML", "stock_quantity": 10000, "minimum_stock_level": 1200, "maximum_stock_level": 30000},
    "Water": {"base_unit": "ML", "stock_quantity": 30000, "minimum_stock_level": 3000, "maximum_stock_level": 80000},
    "Milk": {"base_unit": "ML", "stock_quantity": 30000, "minimum_stock_level": 5000, "maximum_stock_level": 60000},
    "Condensed Milk": {"base_unit": "ML", "stock_quantity": 8000, "minimum_stock_level": 1200, "maximum_stock_level": 20000},
    "Caramel Syrup": {"base_unit": "ML", "stock_quantity": 8000, "minimum_stock_level": 1200, "maximum_stock_level": 20000},
    "Chocolate Syrup": {"base_unit": "ML", "stock_quantity": 8000, "minimum_stock_level": 1200, "maximum_stock_level": 20000},
    "Strawberry Syrup": {"base_unit": "ML", "stock_quantity": 8000, "minimum_stock_level": 1200, "maximum_stock_level": 20000},
    "Mango Syrup": {"base_unit": "ML", "stock_quantity": 8000, "minimum_stock_level": 1200, "maximum_stock_level": 20000},
    "Blueberry Syrup": {"base_unit": "ML", "stock_quantity": 8000, "minimum_stock_level": 1200, "maximum_stock_level": 20000},
    "Green Apple Syrup": {"base_unit": "ML", "stock_quantity": 8000, "minimum_stock_level": 1200, "maximum_stock_level": 20000},
    "Sparkling Water": {"base_unit": "ML", "stock_quantity": 40000, "minimum_stock_level": 5000, "maximum_stock_level": 90000},
    "Matcha Powder": {"base_unit": "G", "stock_quantity": 1500, "minimum_stock_level": 250, "maximum_stock_level": 4000},
    "Chocolate Powder": {"base_unit": "G", "stock_quantity": 3000, "minimum_stock_level": 400, "maximum_stock_level": 8000},
    "Chocnut": {"base_unit": "G", "stock_quantity": 2500, "minimum_stock_level": 400, "maximum_stock_level": 7000},
}

RECIPES = {
    "Espresso": [("Espresso", 30)],
    "Americano": [("Espresso", 60), ("Water", 180)],
    "Cappuccino": [("Espresso", 30), ("Milk", 150)],
    "Spanish Latte": [("Espresso", 30), ("Milk", 150), ("Condensed Milk", 30)],
    "Caramel Macchiato": [("Espresso", 30), ("Milk", 150), ("Caramel Syrup", 20)],
    "Chocnut Latte": [("Espresso", 30), ("Milk", 150), ("Chocnut", 20)],
    "Triple Chocolate Latte": [("Espresso", 30), ("Milk", 150), ("Chocolate Powder", 25), ("Chocolate Syrup", 20)],
    "Classic Matcha": [("Matcha Powder", 6), ("Milk", 180)],
    "Dirty Matcha": [("Matcha Powder", 6), ("Milk", 160), ("Espresso", 30)],
    "Chocnut Matcha": [("Matcha Powder", 6), ("Milk", 160), ("Chocnut", 20)],
    "Strawberry Matcha": [("Matcha Powder", 6), ("Milk", 150), ("Strawberry Syrup", 30)],
    "Sparkling Mango": [("Sparkling Water", 250), ("Mango Syrup", 30)],
    "Sparkling Strawberry": [("Sparkling Water", 250), ("Strawberry Syrup", 30)],
    "Sparkling Blueberry": [("Sparkling Water", 250), ("Blueberry Syrup", 30)],
    "Sparkling Green Apple": [("Sparkling Water", 250), ("Green Apple Syrup", 30)],
}


def infer_recipe(product):
    if product.name in RECIPES:
        return RECIPES[product.name]

    name = product.name.lower()
    category_name = product.category.name.lower() if product.category else ""
    if "soda" in category_name or "sparkling" in name:
        return [("Sparkling Water", 250), ("Fruit Syrup", 30)]
    if "matcha" in name:
        return [("Matcha Powder", 6), ("Milk", 160)]
    if "latte" in name or "cappuccino" in name or "coffee" in category_name:
        return [("Espresso", 30), ("Milk", 150)]
    return []


def ensure_default_ingredients_and_recipes():
    raw_category, _ = Category.objects.get_or_create(
        name="Raw Ingredients",
        defaults={"description": "Ingredient stock used by POS drink recipes"},
    )

    ingredients = {}
    for name, defaults in INGREDIENTS.items():
        ingredient, _ = Ingredient.objects.get_or_create(
            name=name,
            defaults={**defaults, "category": raw_category, "storage_location": "Main Bar"},
        )
        ingredients[name] = ingredient

    if "Fruit Syrup" not in ingredients:
        ingredient, _ = Ingredient.objects.get_or_create(
            name="Fruit Syrup",
            defaults={
                "base_unit": "ML",
                "stock_quantity": 8000,
                "minimum_stock_level": 1200,
                "maximum_stock_level": 20000,
                "category": raw_category,
                "storage_location": "Main Bar",
            },
        )
        ingredients["Fruit Syrup"] = ingredient

    generated = 0
    for product in Product.objects.filter(is_cafe_item=True).select_related("category"):
        recipe = infer_recipe(product)
        if not recipe:
            continue
        for ingredient_name, quantity in recipe:
            ingredient = ingredients.get(ingredient_name)
            if not ingredient:
                continue
            _, created = RecipeIngredient.objects.update_or_create(
                product=product,
                ingredient=ingredient,
                defaults={"quantity": Decimal(str(quantity))},
            )
            if created:
                generated += 1

    return generated
