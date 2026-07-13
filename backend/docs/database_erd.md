# Database ERD

This ERD is generated from the Django application models. Django built-in tables such as `auth_group`, `auth_permission`, `django_admin_log`, `django_content_type`, and `django_session` are omitted for readability.

```mermaid
erDiagram
    users_customuser {
        bigint id PK
        string username UK
        string password
        datetime last_login
        boolean is_superuser
        string first_name
        string last_name
        string email
        boolean is_staff
        boolean is_active
        datetime date_joined
        string role
        string phone_number
        text address
    }

    users_customer {
        bigint id PK
        bigint user_id FK_UK
        int points
        date birthdate
        string loyalty_tier
        text notes
    }

    booking_service {
        bigint id PK
        string name
        text description
        int duration_minutes
        decimal base_price
        string image_url
    }

    booking_package {
        bigint id PK
        bigint service_id FK
        string name
        text description
        decimal price
        text inclusions
    }

    booking_booking {
        bigint id PK
        bigint customer_id FK
        bigint package_id FK
        date scheduled_date
        time scheduled_time
        string status
        text notes
        datetime created_at
    }

    booking_bookingitem {
        bigint id PK
        bigint booking_id FK
        string name
        decimal price
        int quantity
    }

    inventory_supplier {
        bigint id PK
        string name
        string contact_person
        string email
        string phone
        text address
    }

    inventory_category {
        bigint id PK
        string name
        text description
    }

    inventory_product {
        bigint id PK
        string name
        string sku UK
        bigint category_id FK
        bigint supplier_id FK
        decimal cost
        decimal price
        int stock_level
        int reorder_point
        boolean is_cafe_item
        string image_url
    }

    inventory_stockmovement {
        bigint id PK
        bigint product_id FK
        string movement_type
        int quantity
        string reason
        datetime timestamp
        bigint user_id FK
    }

    inventory_purchaseorder {
        bigint id PK
        bigint supplier_id FK
        string status
        text notes
        datetime created_at
        datetime updated_at
    }

    inventory_purchaseorderitem {
        bigint id PK
        bigint purchase_order_id FK
        bigint product_id FK
        int quantity
        decimal cost_price
    }

    pos_order {
        bigint id PK
        bigint staff_id FK
        bigint booking_id FK
        decimal total
        string payment_status
        string order_type
        datetime created_at
    }

    pos_orderitem {
        bigint id PK
        bigint order_id FK
        bigint product_id FK
        int quantity
        decimal price
        decimal subtotal
    }

    pos_payment {
        bigint id PK
        bigint order_id FK
        decimal amount
        string method
        string transaction_id
        datetime timestamp
    }

    sales_dailysalessummary {
        bigint id PK
        date date UK
        decimal total_revenue
        decimal pos_revenue
        decimal booking_revenue
        int transaction_count
    }

    forecasting_salesprediction {
        bigint id PK
        date target_date UK
        decimal predicted_sales
        decimal lower_bound
        decimal upper_bound
        datetime created_at
    }

    forecasting_demandprediction {
        bigint id PK
        bigint product_id FK
        date target_date
        int predicted_quantity
        datetime created_at
    }

    chatbot_chatbotfaq {
        bigint id PK
        string question
        text answer
        string tags
    }

    chatbot_chatbotlog {
        bigint id PK
        bigint user_id FK
        string session_id
        text question
        text response
        datetime timestamp
    }

    notifications_notification {
        bigint id PK
        bigint user_id FK
        string title
        text message
        boolean is_read
        datetime created_at
    }

    audit_auditlog {
        bigint id PK
        bigint user_id FK
        string action
        text description
        string ip_address
        datetime timestamp
    }

    users_customuser ||--o| users_customer : "profile"
    users_customuser ||--o{ booking_booking : "books"
    users_customuser ||--o{ inventory_stockmovement : "records"
    users_customuser ||--o{ pos_order : "staff"
    users_customuser ||--o{ chatbot_chatbotlog : "asks"
    users_customuser ||--o{ notifications_notification : "receives"
    users_customuser ||--o{ audit_auditlog : "performs"

    booking_service ||--o{ booking_package : "has"
    booking_package ||--o{ booking_booking : "selected_for"
    booking_booking ||--o{ booking_bookingitem : "contains"
    booking_booking ||--o{ pos_order : "linked_to"

    inventory_category ||--o{ inventory_product : "categorizes"
    inventory_supplier ||--o{ inventory_product : "supplies"
    inventory_product ||--o{ inventory_stockmovement : "moves"
    inventory_supplier ||--o{ inventory_purchaseorder : "receives"
    inventory_purchaseorder ||--o{ inventory_purchaseorderitem : "contains"
    inventory_product ||--o{ inventory_purchaseorderitem : "ordered"
    inventory_product ||--o{ pos_orderitem : "sold_as"
    inventory_product ||--o{ forecasting_demandprediction : "forecasted"

    pos_order ||--o{ pos_orderitem : "contains"
    pos_order ||--o{ pos_payment : "paid_by"
```

