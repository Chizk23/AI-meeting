import sys
from src.api.domains.meetings import stt as _module

sys.modules[__name__] = _module
