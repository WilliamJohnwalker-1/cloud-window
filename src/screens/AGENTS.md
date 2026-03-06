# Screens AGENTS.md

## OVERVIEW

6 screens (300-1000 lines each) using React Native + Expo + Lucide icons.

## STRUCTURE

- `ProductsScreen.tsx`: Product CRUD, image upload, distributor discount.
- `InventoryScreen.tsx`: Stock management, barcode inbound, low stock alerts.
- `OrdersScreen.tsx`: Order creation, cart, outbound, admin accept.
- `ProfileScreen.tsx`: User profile, city/distributor management, notifications.
- `ReportsScreen.tsx`: Sales/inventory/profit reports, Excel/PDF export.
- `LoginScreen.tsx`: Auth, registration with city/store.

## WHERE TO LOOK

- `FlatList`: Used for all lists (products, orders, notifications).
- `Modal`: Used for all forms and detail views.
- `LinearGradient`: Used for headers and primary buttons.
- `Toast`: Used for feedback on all actions.

## CONVENTIONS

- Use `useAppStore` for all data and actions.
- Use `Colors`, `Radius`, `Shadow` from `../theme`.
- Check `user.role` for conditional rendering (admin vs distributor).
- Implement `onRefresh` for all list screens.

## ANTI-PATTERNS

- Do NOT fetch data directly from Supabase in screens; use `useAppStore`.
- Do NOT use hardcoded colors; use `Colors` from `theme.ts`.
- Avoid complex state in screens; move business logic to `useAppStore`.
