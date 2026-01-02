-- Migration: Add Stripe Price IDs to plans
-- This connects plans to Stripe products for payment processing

-- Fix Business price to $30 (3000 cents) if not already set
UPDATE plans SET price = 3000 WHERE slug = 'business' AND price != 3000;

-- Add Stripe Price IDs to each plan
UPDATE plans SET stripe_price_id = 'price_1SlASsRrBx8E7qRijF76OPfb' WHERE slug = 'starter';
UPDATE plans SET stripe_price_id = 'price_1SlAVZRrBx8E7qRiZPAcrAue' WHERE slug = 'business';
UPDATE plans SET stripe_price_id = 'price_1SlAjmRrBx8E7qRiV4OZ6OVe' WHERE slug = 'pro';

