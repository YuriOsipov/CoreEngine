-- Force first-login password change for provisioned / bootstrap credentials.
ALTER TABLE public.app_user_credentials
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
