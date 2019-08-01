#work in progress
#this script turns an smb created file into a file that can be browsed
#when a file is created on a mac or windows it does not associated the 
#correct permissions and therfore does not add the correct www-data
#group permissions
#
#input=owner of file
owner1="$1"
owner2="$2"
owner3="$3"
sudo chown -R $owner1:www-data /home/$owner1/
sudo chown -R $owner2:www-data /home/$owner2/
sudo chown -R $owner2:www-data /home/$owner3/
