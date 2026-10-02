ALTER TABLE payments.merchants ADD risk_embedding vector<float, 3>;

CREATE INDEX merchants_name_sai ON payments.merchants (name) USING 'sai';
