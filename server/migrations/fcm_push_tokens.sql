-- Push notifications moved from the Expo push service to FCM HTTP v1 direct.
--
-- Expo push tokens ("ExponentPushToken[...]") are ~40 chars, so the original
-- mobile_devices.push_token VARCHAR(255) was ample. Raw FCM registration tokens
-- are much longer (~160 chars today, and Google has grown them over time with no
-- documented ceiling), so widen the column before it silently truncates a token
-- and we push to a device id that no longer exists.
--
-- utf8mb4 VARCHAR(512) = 2048 bytes, still under InnoDB's 3072-byte index limit,
-- so the UNIQUE KEY on push_token is unaffected.

ALTER TABLE mobile_devices
  MODIFY COLUMN push_token VARCHAR(512) NOT NULL;

-- Any Expo-format tokens left over from the previous implementation can never be
-- delivered by the FCM sender; deactivate them so devices re-register on next launch.
UPDATE mobile_devices
   SET is_active = 0
 WHERE push_token LIKE 'Expo%PushToken[%';
