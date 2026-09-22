FROM greenstand/tile-server-base:first
WORKDIR /app
ENV PATH /app/node_modules/.bin:$PATH
COPY . ./
RUN sudo apt-get update
RUN sudo apt install build-essential 
RUN sudo apt-get -y install zlib1g-dev
RUN sudo apt install ca-certificates
#TODO We should build the tile2 image from node 14 alpine
RUN curl -fsSL https://nodejs.org/dist/v14.21.3/node-v14.21.3-linux-x64.tar.gz \
  | sudo tar -xz -C /usr/local --strip-components=1
RUN make release_base
CMD [ "npm", "start" ]
