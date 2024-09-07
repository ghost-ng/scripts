#!/bin/python3

"""
# Flask File Browser Application

## Overview
This script sets up a Flask web application for browsing files and directories. It provides features for viewing file contents, searching through files, and managing user sessions. The application supports serving static files (like images) and provides a basic interface for navigating directories and viewing file content.

## Features
- **File Viewing**: View the contents of text and HTML files.
- **Static File Serving**: Serve images and other static files from specified directories.
- **File Searching**: Search for text or patterns within files in a directory.
- **Directory Navigation**: Navigate between directories and view file lists.
- **Session Management**: Store user preferences like sidebar width in sessions.

## Dependencies
- Flask
- Flask-Session
- python-magic
- BeautifulSoup4
- asyncio
- threading
- concurrent.futures

## Configuration
- **Session Type**: Filesystem
- **Session Directory**: /tmp
- **Session Key Prefix**: 'darkteal:'
- **Session File Threshold**: 500 items

## Usage
1. Run the script using Python 3: `python script_name.py`
2. Access the web application via `http://127.0.0.1:5000/` in your browser.

## Routes
- **/**: Main page for browsing files and directories.
- **/static**: Serve static files (e.g., images).
- **/get_content**: Retrieve content from a specified file.
- **/search**: Search for content within files in a specified directory.
- **/change_folder**: Change the current directory and refresh file list.
- **/set_sidebar_width**: Set the sidebar width in the session.
- **/navigate_file/<direction>**: Navigate to the previous or next file.

## Note
- Ensure to update the `app.secret_key` to a secure value before deploying the application.

"""




from flask import Flask, render_template, request, session, send_from_directory, redirect, url_for, abort, jsonify
from flask_session import Session  # Import the Session object
import os
import asyncio
import magic
import re
from bs4 import BeautifulSoup
from datetime import datetime
import queue
import threading
from concurrent.futures import ThreadPoolExecutor

app = Flask(__name__)
app.secret_key = '5dd6f4b8ea2eda324a5629325e8868a8'  # Change this!
app.config['SESSION_TYPE'] = 'filesystem'  # Specify the session type
app.config['SESSION_FILE_DIR'] = '/tmp'  # Specify the folder to store session data
app.config['SESSION_PERMANENT'] = False  # Whether the session is permanent
app.config['SESSION_USE_SIGNER'] = True  # Whether to sign the session cookie
app.config['SESSION_KEY_PREFIX'] = 'darkteal:'  # Prefix for storing session data
app.config['SESSION_FILE_THRESHOLD'] = 500  # Maximum number of items in a session before it gets stored on the filesystem
Session(app)

matching_files = queue.Queue()

def is_html_content(file_path):
    """Check if the file is HTML."""
    file_type = get_file_type(file_path)
    return file_type == 'text/html'

def adjust_img_tags(content, base_path):
    soup = BeautifulSoup(content, 'html.parser')
    for img_tag in soup.find_all('img', src=True):
        img_tag['src'] = f"/static?image_path={os.path.join(base_path, img_tag['src'])}"
        
    return str(soup)

def is_text(file_path):
    file_type = get_file_type(file_path)
    if file_type and 'text' in file_type:
        #print(f"{file_path} is a text file")
        return True
    else:
        #print(f"{file_path} is NOT a text file")
        return False

def get_file_type(file_path):
    try:
        mime = magic.Magic(mime=True)
        file_type = mime.from_file(file_path)
        return file_type
    except Exception as e:
        print(f"Error determining type of file {file_path}: {str(e)}")
        return None

def get_file_content(file_path):
    """Get the content of a file."""
    try:
        with open(file_path, 'r', encoding='utf-8', errors='replace') as file:
            content = file.read()
            is_html = is_html_content(file_path)
            if is_html:
                soup = BeautifulSoup(content, 'html.parser')
                for a_tag in soup.find_all('a', href=True):
                    # Ensure the href does not already contain clicked_item or folder_path parameters
                    if "clicked_item=" not in a_tag['href'] and "folder_path=" not in a_tag['href']:
                        # Extract the filename from the href
                        href_filename = os.path.basename(a_tag['href'])
                        # Replace the filename with the full path for clicked_item and add folder_path
                        a_tag['href'] = f"?clicked_item={os.path.join(os.path.dirname(file_path), a_tag['href'])}&folder_path={fix_trailing_slash(os.path.dirname(file_path)) + '/'}"


                content = str(soup)
                content = adjust_img_tags(content, os.path.dirname(file_path))
            return content, is_html
    except Exception as e:
        return f"Error reading file: {str(e)}", False

def fix_trailing_slash(folder_path):
    if not folder_path.endswith(os.path.sep):
        folder_path += os.path.sep
    return folder_path

def debug(request):
    try:
        print("Method:", request.method)
    except:
        pass
    try:
        print("URL:", request.url)
    except:
        pass
    try:
        print("Args:", request.args)
    except:
        pass
    try:
        print("Form Data:", request.form)
    except:
        pass


def perform_search(q, search_term, is_regex):
    if is_regex:
        pattern = re.compile(search_term)
    print(f"Thread Name: {threading.current_thread().name}")
    print(f"Thread ID: {threading.current_thread().ident}")
    while True:
        try:
            item = q.get_nowait()
        except queue.Empty:
            break
        if item is None:  # Check for a sentinel value to exit the loop
            break
        #print(f"Processing item: {item}")
        try:
            with open(item, 'r', encoding='utf-8', errors='replace') as file:
                file_content = file.read()
                if (search_term and search_term in file_content) or (is_regex and pattern.search(file_content)):
                    print("Found a file match")
                    matching_files.put_nowait({
                        "name": os.path.basename(item),
                        "path": item,
                        "type": "File",
                        "modified": os.path.getmtime(item),
                        "subject": "",
                        "size": format_size(os.path.getsize(item))
                    })
                    print(item)
        except Exception as e:
            print(f"Error reading file {item}: {str(e)}")
        q.task_done()  # Mark the task as done

@app.route('/static', methods=['GET'])
def serve_static():
    print("Trying to serve an image")
    image_path = request.args.get('image_path', "")
    image_folder = os.path.dirname(image_path)
    image = os.path.basename(image_path)
    print("Folder:",image_folder)
    print("Image Name:", image)
    
    if not image_path or not image:
        abort(400)  # Bad Request

    return send_from_directory(image_folder, image)

@app.route('/static/<path:filename>')
def custom_static(filename):
    response = send_from_directory(app.static_folder, filename)
    response.cache_control.max_age = 10000  # e.g., 60 seconds
    return response

@app.template_filter('datetimeformat')
def datetimeformat(value, format='%Y-%m-%d %H:%M:%S'):
    return datetime.fromtimestamp(value).strftime(format)

@app.route('/get_content', methods=['GET'])
def get_content():
    debug(request)
    file_path = request.args.get('file_path', "")
    file_content, is_html = get_file_content(file_path) if os.path.isfile(file_path) else ("", False)
    return jsonify(content=file_content, is_html=is_html)

def process_and_enqueue(file_path, q):
    if is_text(file_path):
        q.put_nowait(file_path)

@app.route('/search', methods=['GET'])
def search():
    global threads
    debug(request)
    q = queue.Queue()
    search_term = request.args.get('search_term', "")
    is_regex = request.args.get('is_regex', "")
    folder_path = fix_trailing_slash(request.args.get('folder_path', ""))
    session['search_term'] = search_term
    file_path = request.form.get('file_path', "")
    if file_path:
        file_content, is_html = get_file_content(file_path)
    else:
        file_content, is_html = "", False
    sort_by = "modified"

    if is_regex:
        # Validate regex pattern
        try:
            pattern = re.compile(search_term)
        except re.error:
            print("Regex Error")
            return render_template('index.html', error="Invalid regex pattern", file_list=[], folder_path=folder_path, file_content=file_content, search_term="", is_html=is_html, sort_by=sort_by)

    # Search files
    
    items = os.scandir(folder_path)
    with ThreadPoolExecutor(max_workers=30) as executor:
        for i in items:
            queue_threads = []
            # Use a lambda function to pass both root and file_name to process_and_enqueue
            thread = executor.submit(process_and_enqueue, os.path.abspath(i.path), q)
            queue_threads.append(thread)
            for thread in queue_threads:
                thread.result()

    print(f"Total items in queue: {q.qsize()}")
    print("Regex Search:", bool(is_regex))
    threads_search = []
    for _ in range(30):     #max 30 threads
        print("Spinning up threads to search for matches")
        try:
            
            thread = threading.Thread(target=perform_search, args=(q, search_term, is_regex))
            thread.start()
            threads_search.append(thread)
        except Exception as e:
            print("Thread failed:", str(e))
    for t in threads_search:
        t.join()

    # Continue with the rest of the code
    print("All threads have completed.")
    
    # Ensure file name queue is emtpy
    while not q.empty():
        try:
            q.get_nowait()
        except queue.Empty:
            break
    # Ensure matching file name queue is emtpy
    matching_files_list = []
    while not matching_files.empty():
        try:
            matching_files_list.append(matching_files.get_nowait())
        except queue.Empty:
            break
    session['file_list'] = matching_files_list

    return render_template('index.html', file_list=matching_files_list, folder_path=folder_path, file_content=file_content, search_term=search_term, is_html=is_html, sort_by=sort_by)

@app.route('/change_folder', methods=['GET'])
def change_folder():
    debug(request)
    folder_path = fix_trailing_slash(request.args.get('folder_path', ""))
    file_list = []
    file_content = ""
    is_html = False
    sort_by = "name"
    search_term = ""
    action = request.args.get('action', "")

    if action == "parent":
        # Change folder_path to its parent directory
        folder_path = fix_trailing_slash(os.path.dirname(os.path.dirname(folder_path)))


    if os.path.exists(folder_path) and os.path.isdir(folder_path):
        file_list = get_file_list(folder_path, sort_by)
        
    else:
        file_list = [{"name": "Invalid path", "type": "Error", "modified": 0}]

    session['current_folder'] = fix_trailing_slash(folder_path)
    return render_template('index.html', file_list=file_list, folder_path=folder_path, file_content=file_content, search_term=search_term, is_html=is_html, sort_by=sort_by)

def get_subject(html_file_path):
    """
    Extracts the subject from the given HTML file.

    Args:
    - html_file_path (str): Path to the HTML file.

    Returns:
    - str: Extracted subject or None if not found.
    """
    #print("Getting subject for:", html_file_path)
    debug(request)
    if os.path.isdir(html_file_path):
        return ""

    with open(html_file_path, 'r', encoding='utf-8') as file:
        content = file.read()

    soup = BeautifulSoup(content, 'html.parser')

    if soup:
        li_tags = soup.find_all('li')
        if len(li_tags) > 1:
            return li_tags[1].get_text(strip=True).lstrip("Subject: ")

    return ""



def get_file_list(folder_path, sort_by):

    file_list = []
    
    # Get the immediate directories and files inside folder_path

    print("Getting file listing for folder:", folder_path)

    for item in os.scandir(folder_path):
        if item.is_dir():
            item_type = "Directory"
            size = ""
        else:
            item_type = "File"
            size = format_size(os.path.getsize(os.path.abspath(item.path)))

        file_list.append({
            "name": item.name,
            "path": os.path.abspath(item.path),
            "type": item_type,
            "modified": os.path.getmtime(os.path.abspath(item.path)),
            "subject": "",
            "size": size 
        })

    # root, dirs, files = next(os.walk(folder_path))
    
    # # Add directories to the file_list
    # for dir_name in dirs:
    #     dir_path = os.path.join(root, dir_name)
    #     file_list.append({
    #         "name": dir_name,
    #         "path": dir_path,
    #         "type": "Directory",
    #         "modified": os.path.getmtime(dir_path),
    #         "subject": "",
    #         "size": ""  # Directories won't have a size in this context
    #     })
    
    # # Add files to the file_list
    # for file_name in files:
    #     file_path = os.path.join(root, file_name)
        
    #     #get subject
    #     if is_html_content(file_path):
    #         try:
    #             #subject = get_subject(file_path)
    #             subject = ""
    #             pass
    #         except Exception as e:
    #             print("Unable to extract subject from:", file_path)
    #             subject = ""
    #     else:
    #         subject = ""
    #     file_size = os.path.getsize(file_path)  # Get file size in bytes
    #     file_list.append({
    #         "name": file_name,
    #         "path": file_path,
    #         "type": "File",
    #         "modified": os.path.getmtime(file_path),
    #         "subject": "",
    #         "size": format_size(file_size)  # Format the file size for better readability
    #     })

    if sort_by == "modified":
        file_list.sort(key=lambda x: x['modified'], reverse=True)
    elif sort_by == "name":
        file_list.sort(key=lambda x: x['name'])

    print(file_list[:5])  # Print the first 5 entries

    session['file_list'] = file_list
    return file_list


def format_size(size):
    """Format file size for better readability."""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size < 1024:
            return f"{size:.2f} {unit}"
        size /= 1024
    return f"{size:.2f} PB"

@app.route('/set_sidebar_width', methods=['POST'])
def set_sidebar_width():
    width = request.form.get('width')
    session['sidebar_width'] = str(width)
    print("New sidebar width:",session['sidebar_width'])
    return "Width set successfully", 200

@app.route('/navigate_file/<direction>', methods=['GET'])
def navigate_file(direction):
    debug(request)
    current_file = request.args.get('current_file')
    file_list = session.get('file_list', [])
    
    # Debugging statement
    print("Current File:", current_file)
    
    # Find the index of the current file in the file list
    current_index = next((index for index, file in enumerate(file_list) if file['path'] == current_file), None)
    
    # Check if current_index is not None
    if current_index is not None:
        # Determine the next file to display based on the direction
        if direction == 'prev':
            if current_index > 0:
                next_file = file_list[current_index - 1]
            else:
                # Wrap around to the last file in the list
                next_file = file_list[-1]
        elif direction == 'next':
            if current_index < len(file_list) - 1:
                next_file = file_list[current_index + 1]
            else:
                # Wrap around to the first file in the list
                next_file = file_list[0]
    else:
        next_file = None
    
    if next_file:
        # Debugging statement
        print("Next File:", next_file['path'])
        
        # Redirect to the file content display route with the next file's path
        return redirect(url_for('index', folder_path=fix_trailing_slash(os.path.dirname(next_file['path'])), clicked_item=next_file['path'], ref="nav"))
    else:
        # Debugging statement
        print("Not moving to the next file")
        
        # If there's no next/previous file, stay on the current page
        return redirect(request.referrer)


@app.route('/', methods=['GET', 'POST'])
def index():
    debug(request)
    # Initialize variables
    file_content = ""
    search_term = ""
    file_list = ""
    if session.get("current_folder") is None:
        session["current_folder"] = ""
    referrer = request.args.get('ref')
    sort_by = "modified"  # Default sort option
    is_html = False  # Ensure is_html is always defined
    if session.get('sidebar_width') is None:
        session['sidebar_width'] = "400"

    # Handle form submission
    print("Folder path:", request.args.get('folder_path', ""))
    folder_path = fix_trailing_slash(request.args.get('folder_path', ""))
    clicked_item = os.path.normpath(request.args.get('clicked_item', ""))
    print("Stored Folder:", session["current_folder"])
    print("Folder path:", folder_path)
    
    if clicked_item and not is_text(clicked_item) and not os.path.isdir(clicked_item):
        print("File is not text, trying to serve up for download")
        return send_from_directory(folder_path, os.path.basename(clicked_item), as_attachment=True)
    elif clicked_item and os.path.isfile(clicked_item):
        # Refresh the folder list if not coming from the nav function

        if session["current_folder"] == folder_path:
            print("Folder has not changed, not refreshing the folder list")
            file_list = session['file_list']
        elif referrer != "nav":
            print("Refreshing the folder list")
            file_list = get_file_list(folder_path, sort_by)
            session['file_list'] = file_list
        else:
            print("Not refreshing the folder list, refered to from the nav function")
            file_list = session['file_list']
        print("File is type:", get_file_type(clicked_item))
        file_content, is_html = get_file_content(clicked_item)
        print("File:", clicked_item)
        print("Is HTML:", is_html)
        return render_template('index.html', file_list=file_list, folder_path=folder_path, file_content=file_content, search_term=search_term, clicked_item=clicked_item, is_html=is_html, sort_by=sort_by)
    else:
        return render_template('index.html')




if __name__ == '__main__':
    app.run(debug=True)
    

