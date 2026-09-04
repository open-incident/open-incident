/** Prints a fresh VAPID key pair for WEBPUSH_VAPID_PUBLIC_KEY / WEBPUSH_VAPID_PRIVATE_KEY. */
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
console.log(`WEBPUSH_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`WEBPUSH_VAPID_PRIVATE_KEY=${keys.privateKey}`);
