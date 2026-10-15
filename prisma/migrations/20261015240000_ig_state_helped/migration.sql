-- Instagram botu: yönlendirme mesajı gönderilmiş sohbet durumu ("helped"). Bot bu durumda serbest mesajlara yanıt vermez.
ALTER TABLE "ig_conversations" DROP CONSTRAINT "ig_conversations_state_check";
ALTER TABLE "ig_conversations" ADD CONSTRAINT "ig_conversations_state_check" CHECK ("state" IN ('idle', 'helped', 'awaiting_url', 'auditing', 'sending', 'result_sent', 'handoff'));
