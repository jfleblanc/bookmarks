-- Code à 6 chiffres envoyé avec le lien de connexion : on le tape dans la fenêtre où on l'a demandé
ALTER TABLE login_tokens ADD COLUMN code_hash TEXT;
ALTER TABLE login_tokens ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
