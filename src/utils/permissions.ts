/**
 * Centralized role-based permission utilities (v6 upgrade).
 *
 * Pure functions with no side effects. Accept the user's role (or
 * undefined/null when the user/session is not loaded yet) and return a
 * boolean indicating whether the role is allowed to perform the action.
 *
 * Role union (shared by mobile & web):
 *   'admin' | 'super_admin' | 'distributor' | 'inventory_manager' | 'finance'
 *
 * Design notes:
 *   - All functions return `false` for undefined/null/unknown roles so
 *     callers can safely pass `user?.role` without extra guards.
 *   - These utilities are intended for NEW v6 features only; existing
 *     inline role checks are intentionally left untouched in this task.
 */

import type { UserRole } from '../types';

/** Input type: accepts the union plus undefined/null for unloaded sessions. */
export type RoleInput = UserRole | undefined | null;

/** Internal guard: narrow unknown-ish input to a known UserRole. */
function isKnownRole(role: RoleInput): role is UserRole {
  return (
    role === 'admin' ||
    role === 'super_admin' ||
    role === 'distributor' ||
    role === 'inventory_manager' ||
    role === 'finance'
  );
}

/**
 * canViewFinance: finance/admin/super_admin => true
 */
export function canViewFinance(role: RoleInput): boolean {
  if (!isKnownRole(role)) return false;
  return role === 'finance' || role === 'admin' || role === 'super_admin';
}

/**
 * canViewProducts: all roles except finance => true
 */
export function canViewProducts(role: RoleInput): boolean {
  if (!isKnownRole(role)) return false;
  return role !== 'finance';
}

/**
 * canViewOrders: all roles => true
 */
export function canViewOrders(role: RoleInput): boolean {
  if (!isKnownRole(role)) return false;
  return true;
}

/**
 * canEditFinance: finance only => true
 */
export function canEditFinance(role: RoleInput): boolean {
  if (!isKnownRole(role)) return false;
  return role === 'finance';
}

/**
 * canEditFinanceInitialBalance: admin/super_admin/finance => true
 */
export function canEditFinanceInitialBalance(role: RoleInput): boolean {
  if (!isKnownRole(role)) return false;
  return role === 'admin' || role === 'super_admin' || role === 'finance';
}

/**
 * canViewSuppliers: admin/super_admin/finance => true
 */
export function canViewSuppliers(role: RoleInput): boolean {
  if (!isKnownRole(role)) return false;
  return role === 'admin' || role === 'super_admin' || role === 'finance';
}

/**
 * canEditSuppliers: super_admin only => true
 */
export function canEditSuppliers(role: RoleInput): boolean {
  if (!isKnownRole(role)) return false;
  return role === 'super_admin';
}

/**
 * canViewKnowledgeBase: all roles except distributor => true
 */
export function canViewKnowledgeBase(role: RoleInput): boolean {
  if (!isKnownRole(role)) return false;
  return role !== 'distributor';
}

/**
 * canManageKnowledgeBase: admin/super_admin => true
 */
export function canManageKnowledgeBase(role: RoleInput): boolean {
  if (!isKnownRole(role)) return false;
  return role === 'admin' || role === 'super_admin';
}

/**
 * canViewReports: admin/super_admin/finance => true
 */
export function canViewReports(role: RoleInput): boolean {
  if (!isKnownRole(role)) return false;
  return role === 'admin' || role === 'super_admin' || role === 'finance';
}

/**
 * canViewStores: admin/super_admin/finance => true
 */
export function canViewStores(role: RoleInput): boolean {
  if (!isKnownRole(role)) return false;
  return role === 'admin' || role === 'super_admin' || role === 'finance';
}

/**
 * canViewPayment: admin/super_admin/inventory_manager => true
 */
export function canViewPayment(role: RoleInput): boolean {
  if (!isKnownRole(role)) return false;
  return role === 'admin' || role === 'super_admin' || role === 'inventory_manager';
}

/**
 * canEditProductSeries: admin/super_admin => true
 */
export function canEditProductSeries(role: RoleInput): boolean {
  if (!isKnownRole(role)) return false;
  return role === 'admin' || role === 'super_admin';
}

/**
 * canViewInventory: admin/super_admin/inventory_manager => true
 */
export function canViewInventory(role: RoleInput): boolean {
  if (!isKnownRole(role)) return false;
  return (
    role === 'admin' ||
    role === 'super_admin' ||
    role === 'inventory_manager'
  );
}

/**
 * isAdminOrAbove: admin/super_admin => true
 */
export function isAdminOrAbove(role: RoleInput): boolean {
  if (!isKnownRole(role)) return false;
  return role === 'admin' || role === 'super_admin';
}
