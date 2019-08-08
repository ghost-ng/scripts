import shodan
def search_shodan(SHODAN_API_KEY,query):
    api = shodan.Shodan(SHODAN_API_KEY)
    # Search Shodan
    try:
        print("Searching Shodan, this may take a while...")
        results = api.search(query)
        print(results)
        filename = "Shodan_search.txt"
        file = open(filename, "w+")

        for result in results['matches']:
            output = result["ip_str"]+":"+str(result["port"])+"\n"
            file.write(output)
            #print(result["ip_str"])
        file.close()
        return filename

    except shodan.APIError:
        raise shodan.APIError
    except KeyboardInterrupt:
        raise KeyboardInterrupt

key = input("API KEY: ")
query = input("QUERY: ")
search_shodan(key, query)