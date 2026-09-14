@echo off
cd /d "%~dp0"
echo ==== git status ==== > sync_log.txt
git status >> sync_log.txt 2>&1
echo. >> sync_log.txt
echo ==== git add -A ==== >> sync_log.txt
git add -A >> sync_log.txt 2>&1
echo. >> sync_log.txt
echo ==== git commit ==== >> sync_log.txt
git commit -m "Sync local studio work: Houma open-world tab, Profit tab, Hand Font, Voice, Runes/xAI-credits updates" >> sync_log.txt 2>&1
echo. >> sync_log.txt
echo ==== git push ==== >> sync_log.txt
git push origin main >> sync_log.txt 2>&1
echo. >> sync_log.txt
echo ==== DONE ==== >> sync_log.txt
