-- Marka Partneri asistanının başlattığı ücretsiz analizler "assistant" kaynağıyla kaydedilir.
ALTER TABLE "public_audit_requests" DROP CONSTRAINT "public_audit_requests_source_check";
ALTER TABLE "public_audit_requests" ADD CONSTRAINT "public_audit_requests_source_check" CHECK ("source" IN ('web', 'instagram', 'assistant'));
