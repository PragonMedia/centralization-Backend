# centralization-Backend



cb-groc - sudo /usr/local/bin/deploy-cb-groc.sh
cb-ss - sudo /usr/local/bin/deploy-cb-ss.sh
el-cb-groc - sudo /usr/local/bin/deploy-el-cb-groc.sh
el-cb-ss - sudo /usr/local/bin/deploy-el-cb-ss.sh
es-cb-groc - sudo /usr/local/bin/deploy-es-cb-groc.sh
es-cb-ss - sudo /usr/local/bin/deploy-es-cb-ss.sh
backend code - cd /var/www/paragon-be && git pull && npm install && pm2 restart all
backend code - cd /var/www/paragon-be && git pull origin main && pm2 restart all
GENERAIC PAGES - cd /var/www/generic-pages
sudo git pull origin main
Sweeps - cd /var/www/templates/sweep && sudo -u www-data git reset --hard origin/main && sudo -u www-data git pull origin main && sudo chown -R www-data:www-data /var/www/templates/sweep && sudo chmod -R 755 /var/www/templates/sweep
frontend code - cd /var/www/paragon-fe && sudo -u www-data git fetch origin && sudo -u www-data git reset --hard origin/master && sudo npm install && sudo npm run build && sudo chown -R www-data:www-data /var/www/paragon-fe && sudo chmod -R 755 /var/www/paragon-fe
