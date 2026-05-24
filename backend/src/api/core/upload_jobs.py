import sys
from src.api.domains.meetings import upload_jobs as _module

sys.modules[__name__] = _module
