#!/bin/bash
# decode.sh <src-txt> <dest-png>
python3 -c "
import base64,re,sys
s=open(sys.argv[1]).read().strip().strip('\"')
s=re.sub(r'^data:image/png;base64,','',s)
open(sys.argv[2],'wb').write(base64.b64decode(s))
" "$1" "$2" && rm -f "$1"
