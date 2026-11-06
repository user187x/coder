"""PIN verification and unlock grants for the browser gateway.

The PIN lives in the gateway's memory only. A gateway restart also ends every browser session (their profiles are
temporary), so there is no session left for a forgotten PIN to protect."""
import hashlib
import re
import secrets
import time

PIN_PATTERN = r"[0-9]{6,12}"


class BrowserPIN:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.salt = secrets.token_bytes(16)
        self.digest = None
        self.token = None
        self.failures = 0
        self.retry_at = 0

    def configure(self, pin):
        """Set the PIN and return the unlock token of the caller who set it."""
        if self.digest is not None:
            raise ValueError("A PIN is already configured.")
        if not isinstance(pin, str) or not re.fullmatch(PIN_PATTERN, pin):
            raise ValueError("Enter a PIN with 6 to 12 digits.")
        self.digest = self._digest(pin)
        self.token = secrets.token_urlsafe(32)
        return self.token

    def _digest(self, pin):
        return hashlib.scrypt(pin.encode(), salt=self.salt, n=16384, r=8, p=1)

    @property
    def configured(self):
        return self.digest is not None

    def lock(self):
        self.token = None

    def allows(self, token):
        return self.digest is None or (self.token is not None and isinstance(token, str)
                                       and secrets.compare_digest(token.encode(), self.token.encode()))

    def retry_after(self):
        return max(0, int(self.retry_at - self.clock() + 0.999))

    def _verify(self, pin):
        """Check a PIN against the rate limit: five failures, then a growing wait capped at five minutes."""
        now = self.clock()
        if self.digest is None or now < self.retry_at:
            return False
        if isinstance(pin, str) and re.fullmatch(PIN_PATTERN, pin) and secrets.compare_digest(
                self._digest(pin), self.digest):
            self.failures = 0
            return True
        self.failures += 1
        if self.failures >= 5:
            self.retry_at = now + min(300, 30 * (self.failures - 4))
        return False

    def unlock(self, pin):
        """A new unlock token (which replaces any earlier one), or None for a wrong or rate-limited PIN."""
        if not self._verify(pin):
            return None
        self.token = secrets.token_urlsafe(32)
        return self.token

    def clear(self, pin):
        """Remove the PIN when it is given correctly, leaving the gateway unlocked."""
        if not self._verify(pin):
            return False
        self.salt = secrets.token_bytes(16)
        self.digest = None
        self.token = None
        return True

    def status(self, token):
        return {"configured": self.configured, "locked": not self.allows(token), "retryAfter": self.retry_after()}
