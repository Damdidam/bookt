#!/bin/bash
# ============================================================
# test-curl-calls.sh — Tests manuels rapides du filtrage d'appels
# Usage: ./test-curl-calls.sh
# Prérequis: serveur lancé sur localhost:3000
# ============================================================

BASE="http://localhost:3000"
TO="+3221234567"  # Twilio number dans call_settings

echo "🧪 Tests curl — Filtrage d'appels Genda"
echo "========================================="
echo ""

echo "📞 1. Appel normal (mode dépend de la config)"
curl -s -X POST "$BASE/webhooks/twilio/voice/incoming" \
  -d "From=+32470555555&To=$TO&CallSid=CURL_TEST_1" | xmllint --format - 2>/dev/null || echo "(install xmllint for pretty XML)"
echo ""
echo "---"

echo "📞 2. Appel VIP (doit être dans call_whitelist)"
curl -s -X POST "$BASE/webhooks/twilio/voice/incoming" \
  -d "From=+32470111111&To=$TO&CallSid=CURL_TEST_VIP" | xmllint --format - 2>/dev/null || cat
echo ""
echo "---"

echo "📞 3. Appel blacklisté (doit être dans call_blacklist)"
curl -s -X POST "$BASE/webhooks/twilio/voice/incoming" \
  -d "From=+32470999999&To=$TO&CallSid=CURL_TEST_BL" | xmllint --format - 2>/dev/null || cat
echo ""
echo "---"

echo "📞 4. Callback voicemail done"
curl -s -X POST "$BASE/webhooks/twilio/voicemail/done" | xmllint --format - 2>/dev/null || cat
echo ""
echo "---"

echo "📞 5. Callback voicemail status (simule enregistrement)"
curl -s -X POST "$BASE/webhooks/twilio/voicemail/status?bid=YOUR_BUSINESS_ID&from=%2B32470555555" \
  -d "RecordingUrl=https://api.twilio.com/2010-04-01/Accounts/test/Recordings/RE123&RecordingSid=RE123&RecordingDuration=15&CallSid=CURL_TEST_VM"
echo ""
echo "---"

echo "📋 6. Voir les settings (besoin d'un token)"
echo "   curl -H 'Authorization: Bearer TOKEN' $BASE/api/calls/settings"
echo ""

echo "📋 7. Changer le mode"
echo "   curl -X PATCH -H 'Content-Type: application/json' -H 'Authorization: Bearer TOKEN' \\"
echo "     -d '{\"filter_mode\":\"strict\"}' $BASE/api/calls/settings"
echo ""

echo "📋 8. Voir les voicemails"
echo "   curl -H 'Authorization: Bearer TOKEN' $BASE/api/calls/voicemails"
echo ""

echo "✅ Done"
