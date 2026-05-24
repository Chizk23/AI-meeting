import sys
from src.api.domains.admin import analytics as _module

sys.modules[__name__] = _module
