-- Store evidence of the exact legal documents accepted by the user and payer.
ALTER TABLE "User" ADD COLUMN "acceptedTermsVersion" TEXT;
ALTER TABLE "Payment" ADD COLUMN "offerVersion" TEXT;
